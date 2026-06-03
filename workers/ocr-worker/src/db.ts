// Supabase access for the worker, in two modes (config.mode):
//   • direct (v1): a service-role client calls the SECURITY DEFINER RPCs (0062) and
//     Storage straight from the laptop. Simple; the powerful key lives on the laptop.
//   • proxy (M6, hardened): the laptop holds only WORKER_SECRET and routes every op
//     through the ocr-proxy Edge Function, which uses the service role server-side.
// Either way the RPCs are the only write path into the queue.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.ts";

const useProxy = config.mode === "proxy";

// Direct mode only: a real service-role client. Null in proxy mode (no key on laptop).
const supabase: SupabaseClient | null = useProxy
  ? null
  : createClient(config.supabaseUrl, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

/** Call the hardened ocr-proxy Edge Function with the shared secret. */
async function proxy(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${config.supabaseUrl}/functions/v1/ocr-proxy`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": config.workerSecret },
    body: JSON.stringify({ op, ...args }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!res.ok) throw new Error(body?.error ?? `ocr-proxy ${op}: ${res.status}`);
  return body?.data;
}

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
  if (useProxy) {
    await proxy("register", { worker_id: config.workerId, hostname: config.hostname, model: config.model });
    return;
  }
  const { error } = await supabase!.from("ocr_workers").upsert(
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
  if (useProxy) {
    await proxy("offline", { worker_id: config.workerId });
    return;
  }
  await supabase!
    .from("ocr_workers")
    .update({ status: "offline", last_seen_at: new Date().toISOString() })
    .eq("worker_id", config.workerId);
}

/** Atomically lease the next eligible job, or null if the queue is empty. Also
 *  heartbeats the worker (ocr_lease_next touches last_seen_at). */
export async function leaseNext(): Promise<Job | null> {
  if (useProxy) {
    const data = await proxy("lease", {
      worker_id: config.workerId, model: config.model, lease_seconds: config.leaseSeconds, lanes: config.lanes,
    });
    return (data as Job | null) ?? null;
  }
  const { data, error } = await supabase!.rpc("ocr_lease_next", {
    p_worker_id: config.workerId,
    p_model: config.model,
    p_lease_seconds: config.leaseSeconds,
    p_lanes: config.lanes,
  });
  if (error) throw new Error(`ocr_lease_next: ${error.message}`);
  return (data as Job | null) ?? null;
}

export async function complete(jobId: string, json: unknown, sourceDocNo: string | null): Promise<void> {
  if (useProxy) {
    await proxy("complete", { job_id: jobId, model: config.model, json, source_doc_no: sourceDocNo });
    return;
  }
  const { error } = await supabase!.rpc("ocr_complete", {
    p_job_id: jobId,
    p_model: config.model,
    p_json: json,
    p_source_doc_no: sourceDocNo,
  });
  if (error) throw new Error(`ocr_complete: ${error.message}`);
}

export async function fail(jobId: string, message: string): Promise<void> {
  const err = message.slice(0, 1000);
  if (useProxy) {
    await proxy("fail", { job_id: jobId, error: err });
    return;
  }
  const { error } = await supabase!.rpc("ocr_fail", { p_job_id: jobId, p_error: err });
  if (error) throw new Error(`ocr_fail: ${error.message}`);
}

export async function renew(jobId: string): Promise<void> {
  if (useProxy) {
    await proxy("renew", { job_id: jobId, worker_id: config.workerId, lease_seconds: config.leaseSeconds });
    return;
  }
  const { error } = await supabase!.rpc("ocr_renew_lease", {
    p_job_id: jobId,
    p_worker_id: config.workerId,
    p_lease_seconds: config.leaseSeconds,
  });
  if (error) throw new Error(`ocr_renew_lease: ${error.message}`);
}

export async function reclaimExpired(): Promise<number> {
  if (useProxy) {
    return ((await proxy("reclaim")) as number | null) ?? 0;
  }
  const { data, error } = await supabase!.rpc("ocr_reclaim_expired");
  if (error) throw new Error(`ocr_reclaim_expired: ${error.message}`);
  return (data as number | null) ?? 0;
}

/** Download the invoice file from the private bucket. Direct mode reads via the service
 *  client; proxy mode fetches a short-lived signed URL from ocr-proxy. */
export async function downloadFile(path: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (useProxy) {
    const signed = (await proxy("signurl", { path })) as string;
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`download ${path}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, mime: res.headers.get("content-type") || "application/octet-stream" };
  }
  const { data, error } = await supabase!.storage.from(config.bucket).download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message ?? "no data"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, mime: data.type || "application/octet-stream" };
}
