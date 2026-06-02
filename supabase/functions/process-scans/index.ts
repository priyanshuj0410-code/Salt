// Edge Function: process-scans — the FLASH-LANE driver for the OCR queue.
//
// Two-lane model (prd-gemma-ocr-worker.md): the free `queue` lane is drained by the
// local Gemma worker; this function drains the paid/instant `flash` lane with Gemini
// (extract-invoice). It is invoked:
//   • by a shop user (their JWT) right after "Fetch now" flips a job to lane=flash
//     (ocr_request_instant) — drains THAT org's pending flash jobs;
//   • by the M4 cron (pg_net, service-role bearer) — drains ALL orgs' pending flash
//     jobs, so escalated stragglers get Flashed even when every laptop is offline.
//
// For each flash job it downloads the file, calls extract-invoice (reusing its Gemini
// model-chain), then writes the terminal state through the SECURITY DEFINER RPCs
// ocr_complete / ocr_fail (0062) — same idempotency + cross-channel dedup as the Gemma
// lane. It NEVER posts a GRN; the user reviews + posts from scan history.
//
// DEPLOY (user/infra — the agent cannot do this), AFTER 0062_ocr_queue.sql is applied:
//   supabase functions deploy process-scans
//   (GEMINI_API_KEY already set for extract-invoice; SUPABASE_* are auto-injected.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "invoice-scans";
const MAX_PER_RUN = 50; // bound the work per invocation

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");

  const svc = createClient(url, serviceKey);

  // Resolve scope. A user JWT → that org's flash jobs. The service-role key as bearer
  // (the M4 cron via pg_net) → all orgs. Anything else is unauthorized.
  let orgId: string | null = null;
  let allOrgs = false;
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await userClient.auth.getUser();
  if (auth?.user) {
    const { data: mem } = await svc
      .from("memberships").select("org_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
    orgId = (mem as { org_id?: string } | null)?.org_id ?? null;
    if (!orgId) return json({ error: "no organization for current user" }, 400);
  } else if (bearer && bearer === serviceKey) {
    allOrgs = true;
  } else {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const batchId = (body as { batch_id?: string }).batch_id ?? null;

  // Claim this scope's pending FLASH jobs (priority first, then oldest). The free
  // `queue` lane is left for the local Gemma worker.
  let q = svc
    .from("invoice_scans").select("id,storage_path,mime")
    .eq("status", "pending").eq("lane", "flash")
    .order("priority", { ascending: false }).order("queued_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (!allOrgs && orgId) q = q.eq("org_id", orgId);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: scans, error: listErr } = await q;
  if (listErr) return json({ error: listErr.message }, 500);

  const stamp = () => new Date().toISOString();
  let extracted = 0, failed = 0, duplicate = 0;

  for (const s of (scans as { id: string; storage_path: string; mime: string | null }[]) ?? []) {
    // Mark processing first → a concurrent invocation won't re-claim it (it filters pending).
    await svc.from("invoice_scans").update({ status: "processing", model: "flash", updated_at: stamp() }).eq("id", s.id);
    try {
      const dl = await svc.storage.from(BUCKET).download(s.storage_path);
      if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "could not download file");
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const mime = s.mime ?? dl.data.type ?? "application/octet-stream";

      const res = await fetch(`${url}/functions/v1/extract-invoice`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ file_base64: btoa(bin), mime }),
      });
      const out = await res.json();
      if (!res.ok || out?.error) throw new Error(out?.error ?? `extract-invoice ${res.status}`);

      const invoiceNo = typeof out.invoice_no === "string" ? out.invoice_no.trim() || null : null;
      // Terminal state + dedup + model tag, all via the shared RPC (parity with the Gemma lane).
      const { error: cErr } = await svc.rpc("ocr_complete", {
        p_job_id: s.id, p_model: "flash", p_json: out, p_source_doc_no: invoiceNo,
      });
      if (cErr) throw new Error(`ocr_complete: ${cErr.message}`);

      // ocr_complete decided extracted vs duplicate — read it back for the response.
      const { data: after } = await svc.from("invoice_scans").select("status").eq("id", s.id).maybeSingle();
      if ((after as { status?: string } | null)?.status === "duplicate") duplicate++; else extracted++;
    } catch (e) {
      await svc.rpc("ocr_fail", { p_job_id: s.id, p_error: e instanceof Error ? e.message : "extraction failed" });
      failed++;
    }
  }

  return json({ ok: true, total: (scans ?? []).length, extracted, duplicate, failed });
});
