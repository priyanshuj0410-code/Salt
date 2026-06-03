// Salt OCR worker — drains the invoice queue with a local Gemma (Ollama) vision
// model and lands results in the same draft-GRN review path the Flash lane uses.
//
//   lease (ocr_lease_next) -> download file -> rasterize -> Ollama vision JSON
//   -> parse -> ocr_complete  (on error: ocr_fail, which retries with backoff)
//
// The server owns durability (queue + files). This worker is stateless and
// disposable: a crash only delays jobs (the lease is reclaimed), never loses them.
//
//   pnpm start      run the poll loop (default)
//   pnpm once       lease + process exactly one job, then exit (smoke test)
//   pnpm reclaim    one-shot ocr_reclaim_expired() (if not using pg_cron, §M4)
import { config } from "./config.ts";
import { extractInvoice, type Extraction } from "./extract.ts";
import * as db from "./db.ts";

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processJob(job: db.Job): Promise<void> {
  log(`lease ${job.id} org=${job.org_id} attempt=${job.attempts}`);
  const { bytes, mime } = await db.downloadFile(job.storage_path);

  // A laptop extraction can outlive the lease; renew at half the lease window.
  const renewMs = Math.max(30_000, (config.leaseSeconds * 1000) / 2);
  const renewTimer = setInterval(() => {
    db.renew(job.id).catch((e) => log(`renew ${job.id} failed: ${e instanceof Error ? e.message : e}`));
  }, renewMs);

  let extraction: Extraction;
  try {
    extraction = await extractInvoice(bytes, job.mime ?? mime, job.storage_path);
  } finally {
    clearInterval(renewTimer);
  }

  const json = extraction.json;
  const invoiceNo =
    typeof (json as { invoice_no?: unknown })?.invoice_no === "string"
      ? (json as { invoice_no: string }).invoice_no.trim()
      : "";
  await db.complete(job.id, json, invoiceNo || null);
  log(`done ${job.id} invoice=${invoiceNo || "?"} via ${extraction.mode}`);
}

/** Lease + process one job. Returns false when the queue is empty. */
async function tick(): Promise<boolean> {
  const job = await db.leaseNext();
  if (!job) return false;
  try {
    await processJob(job);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`fail ${job.id}: ${msg}`);
    await db.fail(job.id, msg).catch((err) => log(`ocr_fail error: ${err instanceof Error ? err.message : err}`));
  }
  return true;
}

let running = true;

/** One drain lane: keep leasing until the queue empties, then poll. CONCURRENCY
 *  of these run in parallel; ocr_lease_next's FOR UPDATE SKIP LOCKED keeps them
 *  from leasing the same job. */
async function lane(): Promise<void> {
  while (running) {
    let worked = false;
    try {
      worked = await tick();
    } catch (e) {
      log(`tick error: ${e instanceof Error ? e.message : e}`);
    }
    if (!worked && running) await sleep(config.pollIntervalMs);
  }
}

async function loop(): Promise<void> {
  await db.registerWorker();
  log(`worker ${config.workerId} online — model=${config.model} lanes=${config.lanes.join(",")} concurrency=${config.concurrency} -> ${config.supabaseUrl}`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (running) log(`${sig} — finishing in-flight jobs, then exiting`);
      running = false;
    });
  }
  const lanes = Array.from({ length: Math.max(1, config.concurrency) }, () => lane());
  await Promise.all(lanes);
  await db.markOffline().catch(() => {});
  log("stopped");
  process.exit(0);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--reclaim") {
    const n = await db.reclaimExpired();
    log(`reclaimed ${n} expired lease(s)`);
    process.exit(0);
  }
  if (mode === "--once") {
    await db.registerWorker();
    const worked = await tick();
    log(worked ? "processed 1 job" : "queue empty");
    process.exit(0);
  }
  await loop();
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
