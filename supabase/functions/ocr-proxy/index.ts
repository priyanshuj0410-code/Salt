// Edge Function: ocr-proxy — hardened worker auth (M6, prd-gemma-ocr-worker.md §7).
//
// In v1 the laptop worker holds the service-role key directly. This proxy is the
// hardened path: the laptop holds only a shared WORKER_SECRET, and this function —
// running SERVER-SIDE with the service role — verifies that secret and performs the
// privileged queue ops (lease/renew/complete/fail/reclaim, worker registry, signed file
// URLs). The powerful key never leaves Supabase.
//
// DEPLOY (user/infra — verify_jwt OFF; the worker is not a Supabase user, it auth%s via
// the secret header):
//   supabase functions deploy ocr-proxy --no-verify-jwt
//   supabase secrets set WORKER_SECRET=<long-random-string>
// Then on the laptop set WORKER_SECRET (and drop SUPABASE_SERVICE_KEY) in .env.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "invoice-scans";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("WORKER_SECRET");
  if (!secret) return json({ error: "WORKER_SECRET not configured" }, 501);
  if (req.headers.get("x-worker-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(url, serviceKey);

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const op = b.op as string;

  try {
    switch (op) {
      case "register": {
        const { error } = await svc.from("ocr_workers").upsert(
          { worker_id: b.worker_id, hostname: b.hostname, model: b.model, status: "online", last_seen_at: new Date().toISOString() },
          { onConflict: "worker_id" },
        );
        if (error) throw error;
        return json({ data: true });
      }
      case "offline": {
        await svc.from("ocr_workers").update({ status: "offline", last_seen_at: new Date().toISOString() }).eq("worker_id", b.worker_id);
        return json({ data: true });
      }
      case "lease": {
        const { data, error } = await svc.rpc("ocr_lease_next", {
          p_worker_id: b.worker_id, p_model: b.model, p_lease_seconds: b.lease_seconds, p_lanes: b.lanes,
        });
        if (error) throw error;
        return json({ data: data ?? null });
      }
      case "renew": {
        const { error } = await svc.rpc("ocr_renew_lease", { p_job_id: b.job_id, p_worker_id: b.worker_id, p_lease_seconds: b.lease_seconds });
        if (error) throw error;
        return json({ data: true });
      }
      case "complete": {
        const { error } = await svc.rpc("ocr_complete", { p_job_id: b.job_id, p_model: b.model, p_json: b.json, p_source_doc_no: b.source_doc_no ?? null });
        if (error) throw error;
        return json({ data: true });
      }
      case "fail": {
        const { error } = await svc.rpc("ocr_fail", { p_job_id: b.job_id, p_error: b.error });
        if (error) throw error;
        return json({ data: true });
      }
      case "reclaim": {
        const { data, error } = await svc.rpc("ocr_reclaim_expired");
        if (error) throw error;
        return json({ data: data ?? 0 });
      }
      case "signurl": {
        const { data, error } = await svc.storage.from(BUCKET).createSignedUrl(b.path as string, 300);
        if (error || !data) throw error ?? new Error("could not sign url");
        return json({ data: data.signedUrl });
      }
      default:
        return json({ error: `unknown op: ${op}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "proxy error" }, 500);
  }
});
