// Call the local Ollama vision model with the invoice page images. We force JSON
// output and temperature 0 to mirror the Flash extractor's
// (responseMimeType:"application/json", temperature:0), so the JSON shape matches.
// Ollama serves on the SAME laptop as this worker — no tunnel, no exposed port.
import { config } from "./config.ts";

export async function callOllamaVision(images: string[], prompt: string): Promise<string> {
  const res = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      format: "json",
      options: { temperature: 0 },
      // Ollama vision: page images ride on the user message as base64 (no data: prefix).
      messages: [{ role: "user", content: prompt, images }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 404) {
      throw new Error(`Ollama 404: model "${config.model}" not pulled? run \`ollama pull ${config.model}\` — ${detail}`);
    }
    throw new Error(`Ollama ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data?.message?.content ?? "";
  if (!text) throw new Error("Ollama returned no content");
  return text;
}
