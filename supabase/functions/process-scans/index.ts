// Edge Function: process-scans — background extraction of queued invoice scans.
//
// The client uploads several invoice files to the `invoice-scans` bucket as `pending`
// invoice_scans rows (a shared batch_id), then fires this once. It drains the org's
// pending scans SEQUENTIALLY, server-side, so the work survives the user navigating
// away: for each it downloads the file, calls `extract-invoice` (reusing its Gemini
// model-chain — no duplication), dedups against posted GRNs, and updates the scan to
// `extracted` / `duplicate` / `failed`. It NEVER posts a GRN — the user reviews + posts
// from scan history (extracting blindly is unsafe given OCR can misread).
//
// Auth: invoked with the caller's JWT (verify_jwt default on). We resolve their org
// from the JWT, then use the SERVICE ROLE key for the cross-RLS reads/updates + storage
// + the internal extract-invoice call. Scans are always org-scoped to the caller.
//
// DEPLOY (user/infra — the agent cannot do this):
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

  // 1. Resolve the caller's org from their JWT (so we only ever process their scans).
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const svc = createClient(url, serviceKey);
  const { data: mem } = await svc
    .from("memberships").select("org_id").eq("user_id", auth.user.id).limit(1).maybeSingle();
  const orgId = (mem as { org_id?: string } | null)?.org_id;
  if (!orgId) return json({ error: "no organization for current user" }, 400);

  const body = await req.json().catch(() => ({}));
  const batchId = (body as { batch_id?: string }).batch_id ?? null;

  // 2. Claim this org's pending scans, oldest first.
  let q = svc
    .from("invoice_scans").select("id,storage_path,mime")
    .eq("org_id", orgId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(MAX_PER_RUN);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data: scans, error: listErr } = await q;
  if (listErr) return json({ error: listErr.message }, 500);

  const stamp = () => new Date().toISOString();
  let extracted = 0, failed = 0, duplicate = 0;

  // 3. Process sequentially.
  for (const s of (scans as { id: string; storage_path: string; mime: string | null }[]) ?? []) {
    await svc.from("invoice_scans").update({ status: "processing", updated_at: stamp() }).eq("id", s.id);
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

      const invoiceNo = typeof out.invoice_no === "string" ? out.invoice_no.trim() : "";
      const vendor = typeof out.vendor === "string" ? out.vendor.trim() || null : null;

      // Dedup against the whole queue: a posted GRN OR another scan (any channel) with
      // the same invoice number. Sequential processing means an earlier sibling is
      // already 'extracted' (its invoice_no set), so the later upload is flagged.
      let dup = false;
      if (invoiceNo) {
        const { data: exGrn } = await svc
          .from("purchases").select("id").eq("org_id", orgId).ilike("vendor_invoice_no", invoiceNo).limit(1);
        dup = ((exGrn as unknown[] | null)?.length ?? 0) > 0;
        if (!dup) {
          const { data: exScan } = await svc
            .from("invoice_scans").select("id")
            .eq("org_id", orgId).ilike("invoice_no", invoiceNo)
            .in("status", ["extracted", "duplicate", "posted"]).neq("id", s.id).limit(1);
          dup = ((exScan as unknown[] | null)?.length ?? 0) > 0;
        }
      }

      // Primary update — no invoice_no here, so the row always advances out of
      // 'processing' even if migration 0061 hasn't been applied yet.
      await svc.from("invoice_scans").update({
        status: dup ? "duplicate" : "extracted",
        extracted_json: out,
        vendor_guess: vendor,
        error: dup ? "already imported" : null,
        updated_at: stamp(),
      }).eq("id", s.id);
      // Best-effort dedup column (migration 0061); ignore the error if it is absent.
      if (invoiceNo) await svc.from("invoice_scans").update({ invoice_no: invoiceNo }).eq("id", s.id);
      if (dup) duplicate++; else extracted++;
    } catch (e) {
      await svc.from("invoice_scans").update({
        status: "failed",
        error: e instanceof Error ? e.message : "extraction failed",
        updated_at: stamp(),
      }).eq("id", s.id);
      failed++;
    }
  }

  return json({ ok: true, total: (scans ?? []).length, extracted, duplicate, failed });
});
