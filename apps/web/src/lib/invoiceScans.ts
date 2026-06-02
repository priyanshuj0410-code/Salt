// Invoice-scan persistence helpers (SALT-221). Every OCR scan (SALT-027) uploads
// its file to the private `invoice-scans` bucket and writes an `invoice_scans`
// audit row; failed scans retry from the stored file. The pure bits (path/format/
// labels) are unit-tested; the Supabase I/O is here too so the scan page and the
// retry path share one implementation.

import { supabase } from "./supabase";
import type { OcrInvoiceJson } from "./ocrInvoice";

export const INVOICE_SCANS_BUCKET = "invoice-scans";

export type ScanStatus = "pending" | "processing" | "extracted" | "failed" | "posted" | "duplicate";

/** A row of public.invoice_scans (snake_case as stored / fetched). */
export interface InvoiceScanRow {
  id: string;
  storage_path: string;
  original_filename: string | null;
  mime: string | null;
  status: ScanStatus;
  invoice_no: string | null;
  vendor_guess: string | null;
  error: string | null;
  purchase_id: string | null;
  created_at: string;
}

/** Lower-cased file extension from a name or mime, defaulting to "bin". */
export function fileExt(filename: string, mime?: string): string {
  const fromName = filename.includes(".") ? filename.split(".").pop()! : "";
  if (fromName) return fromName.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  // Fall back to the mime subtype (application/pdf → pdf, image/jpeg → jpeg).
  const sub = (mime ?? "").split("/")[1] ?? "";
  return sub.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

/**
 * Object key for a scan's file: `{orgId}/{scanId}.{ext}`. The first path segment
 * is the org id — the Storage RLS policy (0049) gates access on it, so it must be
 * exactly the org uuid, no prefix.
 */
export function scanStoragePath(orgId: string, scanId: string, filename: string, mime?: string): string {
  return `${orgId}/${scanId}.${fileExt(filename, mime)}`;
}

const STATUS_LABEL: Record<ScanStatus, string> = {
  pending: "Queued",
  processing: "Extracting…",
  extracted: "Extracted",
  failed: "Failed",
  posted: "Posted",
  duplicate: "Duplicate",
};

export function scanStatusLabel(s: ScanStatus): string {
  return STATUS_LABEL[s] ?? s;
}

/** Badge tone for a status (maps to the ui/badge variants). */
export function scanStatusVariant(s: ScanStatus): "neutral" | "info" | "success" | "danger" | "warning" {
  switch (s) {
    case "posted":
      return "success";
    case "extracted":
    case "processing":
      return "info";
    case "failed":
      return "danger";
    case "duplicate":
      return "warning";
    default:
      return "neutral";
  }
}

// ── Supabase I/O (shared by the scan page + retry) ───────────────────────────

/** Result of an extract-invoice call, unwrapping the function's error contract. */
export interface ExtractResult {
  json: OcrInvoiceJson | null;
  /** "ocr_not_configured" when the function has no key; else a human error or null. */
  error: string | null;
  notConfigured: boolean;
}

/** Invoke extract-invoice with a base64 file and unwrap the real error from the
 *  Response body (supabase-js leaves it in `context`, not `error.message`). */
export async function invokeExtract(fileBase64: string, mime: string): Promise<ExtractResult> {
  if (!supabase) return { json: null, error: "Not connected.", notConfigured: false };
  const { data, error: fnErr } = await supabase.functions.invoke("extract-invoice", {
    body: { file_base64: fileBase64, mime },
  });
  if (fnErr) {
    const ctx = (fnErr as { context?: Response }).context;
    let bodyError: string | null = null;
    try {
      const j = await ctx?.clone().json();
      bodyError = j?.error ?? null;
    } catch {
      // body wasn't JSON — leave bodyError null and fall back to fnErr.message below
    }
    if (ctx?.status === 501 || bodyError === "ocr_not_configured") {
      return { json: null, error: null, notConfigured: true };
    }
    return { json: null, error: bodyError ?? fnErr.message, notConfigured: false };
  }
  if ((data as { error?: string })?.error === "ocr_not_configured") {
    return { json: null, error: null, notConfigured: true };
  }
  return { json: data as OcrInvoiceJson, error: null, notConfigured: false };
}

/** A best-effort vendor name from the extracted JSON, for the audit row. */
export function vendorGuess(json: OcrInvoiceJson | null): string | null {
  const v = json && typeof (json as { vendor?: unknown }).vendor === "string" ? (json as { vendor: string }).vendor : "";
  return v.trim() || null;
}

/** Best-effort invoice number from the extracted JSON, for the dedup column. */
export function scanInvoiceNo(json: OcrInvoiceJson | null): string | null {
  const v = json && typeof (json as { invoice_no?: unknown }).invoice_no === "string" ? (json as { invoice_no: string }).invoice_no : "";
  return v.trim() || null;
}

/** Upload a file to the bucket under `{orgId}/{fileId}.{ext}`. Returns the object key
 *  (storage path). For CSV uploads the file is stored once and shared by the N rows it
 *  parses into, so the file id is independent of the scan-row ids. */
export async function uploadScanFile(
  orgId: string,
  file: File,
  fileBase64: string,
  fileId: string = crypto.randomUUID(),
): Promise<{ path: string; error?: string }> {
  if (!supabase) return { path: "", error: "Not connected." };
  const path = scanStoragePath(orgId, fileId, file.name, file.type);
  // Upload from the raw bytes (decode our base64 back to a Blob keeps one source of truth).
  const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
  const up = await supabase.storage
    .from(INVOICE_SCANS_BUCKET)
    .upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  return { path, error: up.error?.message };
}

interface ScanRowInput {
  id?: string;
  orgId: string;
  shopId: string | null;
  storagePath: string;
  originalFilename: string | null;
  mime: string | null;
  status: ScanStatus;
  batchId?: string | null;
  extractedJson?: unknown;
  invoiceNo?: string | null;
  vendorGuess?: string | null;
  error?: string | null;
}

/** Insert one invoice_scans row. Low-level — callers set the status + payload. */
export async function insertScanRow(p: ScanRowInput): Promise<{ id: string; error?: string }> {
  if (!supabase) return { id: p.id ?? "", error: "Not connected." };
  const id = p.id ?? crypto.randomUUID();
  const ins = await supabase.from("invoice_scans").insert({
    id,
    org_id: p.orgId,
    shop_id: p.shopId,
    storage_path: p.storagePath,
    original_filename: p.originalFilename,
    mime: p.mime,
    status: p.status,
    batch_id: p.batchId ?? null,
    extracted_json: p.extractedJson ?? null,
    invoice_no: p.invoiceNo ?? null,
    vendor_guess: p.vendorGuess ?? null,
    error: p.error ?? null,
  });
  return { id, error: ins.error?.message };
}

/** Upload the file to the bucket + insert a `pending` invoice_scans row (the OCR path,
 *  where extraction happens after upload). Returns the new scan id (= the file id). */
export async function createScan(
  orgId: string,
  shopId: string | null,
  file: File,
  fileBase64: string,
  batchId?: string | null,
): Promise<{ id: string; error?: string }> {
  const id = crypto.randomUUID();
  const up = await uploadScanFile(orgId, file, fileBase64, id);
  if (up.error) return { id, error: up.error };
  return insertScanRow({
    id,
    orgId,
    shopId,
    storagePath: up.path,
    originalFilename: file.name,
    mime: file.type || null,
    status: "pending",
    batchId: batchId ?? null,
  });
}

/** Insert an already-extracted scan row (the CSV path — parsing is client-side, so the
 *  row lands `extracted` straight away). The file is uploaded once via `uploadScanFile`;
 *  one row per invoice it contains shares that `storagePath`. When `dupRef` is given the
 *  invoice already exists (posted GRN or queued scan) so the row is marked `duplicate`. */
export async function insertExtractedScan(
  orgId: string,
  shopId: string | null,
  file: { path: string; filename: string | null; mime: string | null },
  invoiceJson: OcrInvoiceJson,
  dupRef?: string | null,
  batchId?: string | null,
): Promise<{ id: string; error?: string }> {
  return insertScanRow({
    orgId,
    shopId,
    storagePath: file.path,
    originalFilename: file.filename,
    mime: file.mime,
    status: dupRef ? "duplicate" : "extracted",
    extractedJson: invoiceJson,
    invoiceNo: scanInvoiceNo(invoiceJson),
    vendorGuess: vendorGuess(invoiceJson),
    error: dupRef ? `already imported (${dupRef})` : null,
    batchId: batchId ?? null,
  });
}

/** Fire the background extraction worker for a batch (fire-and-forget). It drains the
 *  org's pending scans server-side via the process-scans function, so the user can
 *  navigate away while their multi-file upload extracts. */
export async function kickoffProcessScans(batchId?: string | null): Promise<void> {
  if (!supabase) return;
  void supabase.functions.invoke("process-scans", { body: batchId ? { batch_id: batchId } : {} });
}

/** Patch a scan row (status + the extracted json / invoice no / error / posted GRN). */
export async function updateScan(
  id: string,
  patch: Partial<{ status: ScanStatus; extracted_json: unknown; invoice_no: string | null; vendor_guess: string | null; error: string | null; purchase_id: string }>,
): Promise<void> {
  if (!supabase) return;
  await supabase.from("invoice_scans").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** Download a stored scan file and return it base64-encoded — the retry source. */
export async function downloadScanBase64(storagePath: string): Promise<{ base64: string; mime: string } | { error: string }> {
  if (!supabase) return { error: "Not connected." };
  const dl = await supabase.storage.from(INVOICE_SCANS_BUCKET).download(storagePath);
  if (dl.error || !dl.data) return { error: dl.error?.message ?? "could not download file" };
  const buf = new Uint8Array(await dl.data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { base64: btoa(bin), mime: dl.data.type || "application/octet-stream" };
}

/** A short-lived signed URL to view/download a stored scan file. */
export async function signedScanUrl(storagePath: string, expiresSec = 300): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(INVOICE_SCANS_BUCKET).createSignedUrl(storagePath, expiresSec);
  return data?.signedUrl ?? null;
}

/** Remove a scan from the audit trail: delete its stored file, then its row. When the
 *  scan was posted as a GRN (`purchaseId`), first fully reverse + delete that GRN
 *  (`delete_purchase`, 0058) — stock, vendor payable and ITC are undone, with on-hand
 *  allowed to go negative as a "purchase invoice missing" flag. File removal is
 *  best-effort; the row delete is what the caller cares about (RLS policies, 0049). */
export async function deleteScan(id: string, storagePath: string, purchaseId?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected." };
  if (purchaseId) {
    const { error: e } = await supabase.rpc("delete_purchase", { p_purchase_id: purchaseId });
    if (e) return { error: `Could not delete the GRN: ${e.message}` };
  }
  // A CSV upload stores its file once and shares it across the N rows it parsed into —
  // only remove the stored file when no sibling row still points at it.
  const { count } = await supabase
    .from("invoice_scans")
    .select("id", { count: "exact", head: true })
    .eq("storage_path", storagePath)
    .neq("id", id);
  if (!count) await supabase.storage.from(INVOICE_SCANS_BUCKET).remove([storagePath]);
  const { error } = await supabase.from("invoice_scans").delete().eq("id", id);
  return error ? { error: error.message } : {};
}

/** A scan's stored extraction — lets the scan page review + post a background-extracted
 *  scan from history (`?scan=<id>`) without re-running OCR. */
export async function getScanJson(orgId: string, scanId: string): Promise<OcrInvoiceJson | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("invoice_scans").select("extracted_json").eq("id", scanId).eq("org_id", orgId).maybeSingle();
  return (data as { extracted_json?: OcrInvoiceJson } | null)?.extracted_json ?? null;
}
