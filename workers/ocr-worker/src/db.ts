// Supabase access for the worker: a service-role client (bypasses RLS — trusted
// local worker, PRD §7 v1) plus thin wrappers over the SECURITY DEFINER RPCs
// from migration 0062. The RPCs are the ONLY write path into the queue.
import { createClient } from "@supabase/supabase-js";
import { config } from "./config.ts";

export const supabase = createClient(config.supabaseUrl, config.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The leased job (a subset of the invoice_scans row we actually use). */
export interface Job {
  id: string;
  org_id: string;
  storage_path: string;
  mime: string | null;
  invoice_no: string | null;
  attempts: number;
}

/** Upsert our registry row (with hostname) so the operator console can see us. */
export async function registerWorker(): Promise<void> {
  const { error } = await supabase.from("ocr_workers").upsert(
    {
      worker_id: config.workerId,
      hostname: config.hostname,
      model: config.model,
      status: "online",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "worker_id" },
  );
  if (error) throw new Error(`registerWorker: ${error.message}`);
}

export async function markOffline(): Promise<void> {
  await supabase
    .from("ocr_workers")
    .update({ status: "offline", last_seen_at: new Date().toISOString() })
    .eq("worker_id", config.workerId);
}

/** Atomically lease the next eligible job, or null if the queue is empty. Also
 *  heartbeats the worker (ocr_lease_next touches last_seen_at). */
export async function leaseNext(): Promise<Job | null> {
  const { data, error } = await supabase.rpc("ocr_lease_next", {
    p_worker_id: config.workerId,
    p_model: config.model,
    p_lease_seconds: config.leaseSeconds,
    p_lanes: config.lanes,
  });
  if (error) throw new Error(`ocr_lease_next: ${error.message}`);
  return (data as Job | null) ?? null;
}

export async function complete(jobId: string, json: unknown, sourceDocNo: string | null): Promise<void> {
  const { error } = await supabase.rpc("ocr_complete", {
    p_job_id: jobId,
    p_model: config.model,
    p_json: json,
    p_source_doc_no: sourceDocNo,
  });
  if (error) throw new Error(`ocr_complete: ${error.message}`);
}

export async function fail(jobId: string, message: string): Promise<void> {
  const { error } = await supabase.rpc("ocr_fail", { p_job_id: jobId, p_error: message.slice(0, 1000) });
  if (error) throw new Error(`ocr_fail: ${error.message}`);
}

export async function renew(jobId: string): Promise<void> {
  const { error } = await supabase.rpc("ocr_renew_lease", {
    p_job_id: jobId,
    p_worker_id: config.workerId,
    p_lease_seconds: config.leaseSeconds,
  });
  if (error) throw new Error(`ocr_renew_lease: ${error.message}`);
}

export async function reclaimExpired(): Promise<number> {
  const { data, error } = await supabase.rpc("ocr_reclaim_expired");
  if (error) throw new Error(`ocr_reclaim_expired: ${error.message}`);
  return (data as number | null) ?? 0;
}

/** Download the invoice file from the private bucket (service role). */
export async function downloadFile(path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { data, error } = await supabase.storage.from(config.bucket).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, mime: data.type || "application/octet-stream" };
}
