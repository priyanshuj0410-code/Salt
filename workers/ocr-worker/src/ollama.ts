// Call the local Ollama model. We force JSON output and temperature 0 to mirror the
// Flash extractor's (responseMimeType:"application/json", temperature:0), so the JSON
// shape matches. Ollama serves on the SAME laptop as this worker — no tunnel.
//
// Uses node:http (not global fetch): undici caps headers at ~300s, but cold-loading a
// large model + a vision pass on a laptop routinely runs longer. We STREAM the response
// (stream:true) so we can report live progress (token count) AND keep the socket active
// during long generations (no spurious idle timeout). `model` and `onProgress` are
// per-call; `think:false` makes thinking models emit JSON directly (retried off if a
// non-thinking model rejects it).
import http from "node:http";
import https from "node:https";
import { config } from "./config.ts";

interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
}

/** Live progress while the model generates (tokens streamed so far). */
export type ProgressFn = (info: { tokens: number }) => void;

function requestOnce(messages: ChatMessage[], model: string, think: boolean | undefined, onProgress?: ProgressFn): Promise<string> {
  const url = new URL("/api/chat", config.ollamaHost);
  const body = JSON.stringify({
    model,
    stream: true,
    format: "json",
    ...(think === undefined ? {} : { think }),
    options: { temperature: 0, num_ctx: config.numCtx, num_predict: config.numPredict },
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
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          const errChunks: Buffer[] = [];
          res.on("data", (c: Buffer) => errChunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(errChunks).toString("utf8");
            if (status === 404) {
              return reject(new Error(`Ollama 404: model "${model}" not pulled? run \`ollama pull ${model}\` — ${raw.slice(0, 300)}`));
            }
            reject(new Error(`Ollama ${status}: ${raw.slice(0, 300)}`));
          });
          return;
        }
        // Stream of NDJSON lines: {"message":{"content":"…"},"done":false} … {"done":true}
        let content = "";
        let tokens = 0;
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let obj: { message?: { content?: string }; error?: string; done?: boolean };
            try {
              obj = JSON.parse(line);
            } catch {
              continue;
            }
            if (obj.error) {
              req.destroy();
              return reject(new Error(`Ollama (${model}): ${obj.error}`));
            }
            const piece = obj.message?.content ?? "";
            if (piece) {
              content += piece;
              tokens++;
              if (onProgress && tokens % 16 === 0) onProgress({ tokens });
            }
          }
        });
        res.on("end", () => {
          if (onProgress && tokens > 0) onProgress({ tokens });
          if (!content) return reject(new Error(`Ollama (${model}) returned no content`));
          resolve(content);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Ollama timed out after ${config.ollamaTimeoutMs}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function postChat(messages: ChatMessage[], model: string = config.model, onProgress?: ProgressFn): Promise<string> {
  let think: boolean | undefined = false; // gemma4/qwen3 emit JSON directly with this off
  let crashRetried = false;
  for (;;) {
    try {
      return await requestOnce(messages, model, think, onProgress);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A non-thinking model (qwen2.5) rejects `think` → drop it and retry.
      if (think === false && /think/i.test(msg)) {
        think = undefined;
        continue;
      }
      // The runner can die transiently (Ollama restarts it) — retry once after a beat.
      if (!crashRetried && /runner|terminated|unexpectedly stopped|\bEOF\b|\b50[0-9]\b/i.test(msg)) {
        crashRetried = true;
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      throw e;
    }
  }
}

/** Vision: invoice page images ride on the user message as base64 (no data: prefix). */
export function callOllamaVision(images: string[], prompt: string, model?: string, onProgress?: ProgressFn): Promise<string> {
  return postChat([{ role: "user", content: prompt, images }], model, onProgress);
}

/** Text: e.g. a digital PDF's text layer or a CSV export pasted into the prompt. */
export function callOllamaText(prompt: string, model?: string, onProgress?: ProgressFn): Promise<string> {
  return postChat([{ role: "user", content: prompt }], model, onProgress);
}

export interface OllamaModel {
  name: string;
  size?: number;
  vision: boolean;
}

/** List installed Ollama models, flagged for vision capability (for the model picker). */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  const tagsRes = await fetch(new URL("/api/tags", config.ollamaHost));
  if (!tagsRes.ok) throw new Error(`Ollama /api/tags ${tagsRes.status}`);
  const tags = (await tagsRes.json()) as { models?: { name: string; size?: number }[] };
  const out: OllamaModel[] = [];
  for (const m of tags.models ?? []) {
    let vision = false;
    try {
      const showRes = await fetch(new URL("/api/show", config.ollamaHost), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: m.name }),
      });
      if (showRes.ok) {
        const show = (await showRes.json()) as { capabilities?: string[] };
        vision = (show.capabilities ?? []).includes("vision");
      }
    } catch {
      // capability probe failed — leave vision=false, model still selectable
    }
    out.push({ name: m.name, size: m.size, vision });
  }
  return out;
}
