// Worker config from the environment. `pnpm start` runs via `node --env-file=.env`,
// so process.env already carries .env. Service-role key lives here on the LAPTOP
// only — never in apps/web, never committed (.env is gitignored).
import os from "node:os";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name} — copy .env.example to .env and fill it in.`);
  return v;
}
function opt(name: string, dflt: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : dflt;
}
function num(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

// Auth: v1 holds the service-role key on the laptop; the hardened path (M6) holds only
// WORKER_SECRET and routes every privileged op through the ocr-proxy Edge Function.
const serviceKey = opt("SUPABASE_SERVICE_KEY", "");
const workerSecret = opt("WORKER_SECRET", "");
if (!serviceKey && !workerSecret) {
  throw new Error("Set SUPABASE_SERVICE_KEY (v1) or WORKER_SECRET (hardened proxy) in .env — see .env.example");
}

export const config = {
  supabaseUrl: req("SUPABASE_URL"),
  serviceKey,
  workerSecret,
  mode: workerSecret ? ("proxy" as const) : ("direct" as const),
  ollamaHost: opt("OLLAMA_HOST", "http://localhost:11434"),
  model: req("OCR_MODEL"),
  workerId: opt("WORKER_ID", `${os.hostname()}-${process.pid}`),
  hostname: os.hostname(),
  // Which lanes to drain. 'queue' = the free local-Gemma lane; add 'flash' to also
  // let this laptop pick up escalated/instant jobs locally.
  lanes: opt("OCR_LANES", "queue").split(",").map((s) => s.trim()).filter(Boolean),
  leaseSeconds: num("LEASE_SECONDS", 300),
  pollIntervalMs: num("POLL_INTERVAL_MS", 5000),
  // Ollama can take minutes to cold-load a large model + run vision on a laptop;
  // node:http has no undici 300s cap, so give it a generous idle ceiling.
  ollamaTimeoutMs: num("OLLAMA_TIMEOUT_MS", 600000),
  // Cap generated tokens. gemma4 stops cleanly; some models (e.g. qwen) run away under
  // JSON mode and would hang. 8192 ≈ a ~50-line invoice; raise for huge bills.
  numPredict: num("OLLAMA_NUM_PREDICT", 8192),
  concurrency: num("CONCURRENCY", 1),
  bucket: opt("OCR_BUCKET", "invoice-scans"),
  maxImagePx: num("MAX_IMAGE_PX", 1500),
};
