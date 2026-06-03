// Call the local Ollama model. We force JSON output and temperature 0 to mirror the
// Flash extractor's (responseMimeType:"application/json", temperature:0), so the JSON
// shape matches. Ollama serves on the SAME laptop as this worker — no tunnel.
//
// Uses node:http (not global fetch): undici caps headers at ~300s, but cold-loading a
// large model + a vision pass on a laptop routinely runs longer. node:http lets us set
// a generous idle timeout (OLLAMA_TIMEOUT_MS) instead of failing spuriously.
//
// `model` is overridable per call (the test harness compares models); it defaults to
// config.model (what the worker runs). We send think:false so a *thinking* model (gemma4,
// qwen3) emits the JSON directly instead of burning its token budget on a prose reasoning
// summary (that was returning "Based on the data provided…" instead of JSON). A model that
// rejects the flag (a non-thinking model like qwen2.5) is retried without it.
import http from "node:http";
import https from "node:https";
import { config } from "./config.ts";

interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
}

function requestOnce(messages: ChatMessage[], model: string, think: boolean | undefined): Promise<string> {
  const url = new URL("/api/chat", config.ollamaHost);
  const body = JSON.stringify({
    model,
    stream: false,
    format: "json",
    ...(think === undefined ? {} : { think }),
    options: { temperature: 0, num_predict: config.numPredict },
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
              return reject(new Error(`Ollama 404: model "${model}" not pulled? run \`ollama pull ${model}\` — ${raw.slice(0, 300)}`));
            }
            return reject(new Error(`Ollama ${status}: ${raw.slice(0, 300)}`));
          }
          try {
            const data = JSON.parse(raw) as { message?: { content?: string } };
            const content = data?.message?.content ?? "";
            if (!content) return reject(new Error(`Ollama (${model}) returned no content`));
            resolve(content);
          } catch {
            reject(new Error(`Ollama (${model}) unexpected response envelope: ${raw.slice(0, 200)}`));
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

async function postChat(messages: ChatMessage[], model: string = config.model): Promise<string> {
  try {
    return await requestOnce(messages, model, false);
  } catch (e) {
    // A non-thinking model rejects `think` → retry without it.
    if (/think/i.test(e instanceof Error ? e.message : String(e))) {
      return requestOnce(messages, model, undefined);
    }
    throw e;
  }
}

/** Vision: invoice page images ride on the user message as base64 (no data: prefix). */
export function callOllamaVision(images: string[], prompt: string, model?: string): Promise<string> {
  return postChat([{ role: "user", content: prompt, images }], model);
}

/** Text: e.g. a digital PDF's text layer or a CSV export pasted into the prompt. */
export function callOllamaText(prompt: string, model?: string): Promise<string> {
  return postChat([{ role: "user", content: prompt }], model);
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
