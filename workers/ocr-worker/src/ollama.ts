// Call the local Ollama model. We force JSON output and temperature 0 to mirror the
// Flash extractor's (responseMimeType:"application/json", temperature:0), so the JSON
// shape matches. Ollama serves on the SAME laptop as this worker — no tunnel.
//
// Uses node:http (not global fetch): undici caps headers at ~300s, but cold-loading a
// large model + a vision pass on a laptop routinely runs longer. node:http lets us set
// a generous idle timeout (OLLAMA_TIMEOUT_MS) instead of failing spuriously.
import http from "node:http";
import https from "node:https";
import { config } from "./config.ts";

interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
}

function postChat(messages: ChatMessage[]): Promise<string> {
  const url = new URL("/api/chat", config.ollamaHost);
  const body = JSON.stringify({
    model: config.model,
    stream: false,
    format: "json",
    think: false, // gemma4 etc. can "think"; we want pure JSON, no reasoning preamble
    options: { temperature: 0 },
    messages,
  });
  const lib = url.protocol === "https:" ? https : http;

  return new Promise<string>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: config.ollamaTimeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            if (status === 404) {
              return reject(new Error(`Ollama 404: model "${config.model}" not pulled? run \`ollama pull ${config.model}\` — ${raw.slice(0, 300)}`));
            }
            return reject(new Error(`Ollama ${status}: ${raw.slice(0, 300)}`));
          }
          try {
            const data = JSON.parse(raw) as { message?: { content?: string } };
            const content = data?.message?.content ?? "";
            if (!content) return reject(new Error("Ollama returned no content"));
            resolve(content);
          } catch {
            reject(new Error(`Ollama: unexpected response envelope: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Ollama timed out after ${config.ollamaTimeoutMs}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Vision: invoice page images ride on the user message as base64 (no data: prefix). */
export function callOllamaVision(images: string[], prompt: string): Promise<string> {
  return postChat([{ role: "user", content: prompt, images }]);
}

/** Text: e.g. a CSV/tabular export pasted into the prompt (the test harness CSV path). */
export function callOllamaText(prompt: string): Promise<string> {
  return postChat([{ role: "user", content: prompt }]);
}
