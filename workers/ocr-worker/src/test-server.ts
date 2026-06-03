// Local OCR extraction tester (the §14.1 accuracy-gate harness). Serves a Salt-skinned
// page and runs the REAL worker pipeline server-side — poppler rasterize → Ollama Gemma
// vision → the same prompt + parser the worker uses — so you can eyeball extraction
// quality on real PDFs / images / CSVs before trusting the free lane. No Supabase needed.
// If GEMINI_API_KEY is set it also runs Gemini Flash side by side (the comparison).
//
//   pnpm test-ui        → http://localhost:5599
//
// Loads .env if present (for OCR_MODEL / OLLAMA_HOST / GEMINI_API_KEY); otherwise uses
// sensible defaults. Supabase creds are NOT required here.
import http from "node:http";
import { readFileSync } from "node:fs";

try {
  process.loadEnvFile();
} catch {
  // No .env yet — fine for a first test; defaults below cover it.
}
process.env.OCR_MODEL ||= "gemma4:26b-a4b-it-q4_K_M";
process.env.OLLAMA_HOST ||= "http://localhost:11434";
process.env.SUPABASE_URL ||= "http://localhost"; // unused by the tester
process.env.SUPABASE_SERVICE_KEY ||= "unused"; // unused; only satisfies config.ts

// Import AFTER env is set so config.ts validates against it.
const { config } = await import("./config.ts");
const { PROMPT, parseModelJson } = await import("./contract.ts"); // used by the Flash comparison
const { extractInvoice } = await import("./extract.ts");
const { listOllamaModels } = await import("./ollama.ts");

const PORT = Number(process.env.TEST_UI_PORT ?? 5599);
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const PAGE = readFileSync(new URL("./test-ui.html", import.meta.url), "utf8");

interface ExtractBody {
  filename?: string;
  mime?: string;
  base64?: string;
  runFlash?: boolean;
  model?: string;
}

function isCsv(mime: string, filename: string): boolean {
  return mime.startsWith("text/") || /csv$/i.test(mime) || /\.csv$/i.test(filename);
}

/** Gemini Flash, mirroring extract-invoice: PDFs/images inline, CSV/text as a text part. */
async function callFlash(base64: string, mime: string, filename: string): Promise<unknown> {
  const part = isCsv(mime, filename)
    ? { text: `CSV / tabular export to map into the schema below:\n\n${Buffer.from(base64, "base64").toString("utf8")}` }
    : { inline_data: { mime_type: mime, data: base64 } };
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({ contents: [{ parts: [part, { text: PROMPT }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return parseModelJson(text);
}

interface EngineResult {
  json?: unknown;
  ms?: number;
  mode?: string;
  error?: string;
}

function lineCount(json: unknown): number | string {
  return json && typeof json === "object" && Array.isArray((json as { lines?: unknown }).lines)
    ? (json as { lines: unknown[] }).lines.length
    : "?";
}

async function extract(body: ExtractBody, onStage: (msg: string) => void): Promise<Record<string, unknown>> {
  const mime = body.mime ?? "application/octet-stream";
  const filename = body.filename ?? "";
  const base64 = body.base64 ?? "";
  if (!base64) throw new Error("no file data");
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));

  const model = body.model || config.model;
  const out: Record<string, unknown> = { model };
  onStage(`Received ${filename || "file"} — ${(bytes.length / 1024).toFixed(0)} KB, ${mime}`);

  // --- Gemma / chosen local model (the real worker path: pdf-text / pdf-vision / image / csv-text) ---
  const t0 = Date.now();
  try {
    const ex = await extractInvoice(bytes, mime, filename, model, onStage);
    out.gemma = { json: ex.json, ms: Date.now() - t0, mode: ex.mode } satisfies EngineResult;
    out.images = ex.images;
    out.text = ex.text ? ex.text.slice(0, 8000) : null;
    onStage(`✓ ${model} done in ${((Date.now() - t0) / 1000).toFixed(1)}s — mode ${ex.mode}, ${lineCount(ex.json)} line(s)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.gemma = { error: msg, ms: Date.now() - t0 } satisfies EngineResult;
    out.images = [];
    out.text = null;
    onStage(`✗ ${model} failed: ${msg}`);
  }

  // --- Flash (optional comparison) ---
  if (body.runFlash && GEMINI_KEY) {
    onStage("Running Gemini Flash…");
    const f0 = Date.now();
    try {
      out.flash = { json: await callFlash(base64, mime, filename), ms: Date.now() - f0 } satisfies EngineResult;
      onStage(`✓ Flash done in ${((Date.now() - f0) / 1000).toFixed(1)}s`);
    } catch (e) {
      out.flash = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - f0 } satisfies EngineResult;
      onStage("✗ Flash failed");
    }
  }
  return out;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (req.method === "GET" && req.url === "/config") {
    json(res, 200, { model: config.model, flash: Boolean(GEMINI_KEY) });
    return;
  }
  if (req.method === "GET" && req.url === "/models") {
    void (async () => {
      try {
        json(res, 200, { models: await listOllamaModels(), default: config.model });
      } catch (e) {
        json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return;
  }
  if (req.method === "POST" && req.url === "/extract") {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 60 * 1024 * 1024) {
        json(res, 413, { error: "file too large (>60MB)" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      void (async () => {
        let body: ExtractBody;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ExtractBody;
        } catch {
          return json(res, 400, { error: "invalid JSON body" });
        }
        // Stream NDJSON: one {"stage":…} per progress event, then a final {"result":…}.
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
        const ts = () => new Date().toISOString().slice(11, 19);
        const send = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);
        const onStage = (msg: string) => {
          console.log(`${ts()}  ${msg}`);
          send({ stage: msg });
        };
        try {
          send({ result: await extract(body, onStage) });
        } catch (e) {
          send({ result: { error: e instanceof Error ? e.message : String(e) } });
        }
        res.end();
      })();
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`\n  Salt OCR tester → http://localhost:${PORT}`);
  console.log(`  model=${config.model}  ollama=${config.ollamaHost}  flash=${GEMINI_KEY ? "on" : "off (set GEMINI_API_KEY to enable)"}\n`);
});
