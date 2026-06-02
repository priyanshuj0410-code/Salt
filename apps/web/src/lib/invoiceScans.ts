// Invoice-scan persistence helpers (SALT-221). Every OCR scan (SALT-027) uploads
// its file to the private `invoice-scans` bucket and writes an `invoice_scans`
// audit row; failed scans retry from the stored file. The pure bits (path/format/
// labels) are unit-tested; the Supabase I/O is here too so the scan page and the
// retry path share one implementation.

import { supabase } from "./supabase";
import type { OcrInvoiceJson } from "./ocrInvoice";

export const INVOICE_SCANS_BUCKET = "invoice-scans";

export type ScanStatus = "pending" | "extracted" | "failed" | "posted";

/** A row of public.invoice_scans (snake_case as stored / fetched). */
export interface InvoiceScanRow {
  id: string;
  storage_path: string;
  original_filename: string | null;
  mime: string | null;
  status: ScanStatus;
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
  pending: "Uploading…",
  extracted: "Extracted",
  failed: "Failed",
  posted: "Posted",
};

export function scanStatusLabel(s: ScanStatus): string {
  return STATUS_LABEL[s] ?? s;
}

/** Badge tone for a status (maps to the ui/badge variants). */
export function scanStatusVariant(s: ScanStatus): "neutral" | "info" | "success" | "danger" {
  switch (s) {
    case "posted":
      return "success";
    case "extracted":
      return "info";
    case "failed":
      return "danger";
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

/** Upload the file to the bucket + insert a `pending` invoice_scans row. Returns
 *  the new scan id (and its storage path), or an error string. */
export async function createScan(
  orgId: string,
  shopId: string | null,
  file: File,
  fileBase64: string,
): Promise<{ id: string; error?: string }> {
  if (!supabase) return { id: "", error: "Not connected." };
  const id = crypto.randomUUID();
  const path = scanStoragePath(orgId, id, file.name, file.type);
  // Upload from the raw bytes (decode our base64 back to a Blob keeps one source of truth).
  const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
  const up = await supabase.storage
    .from(INVOICE_SCANS_BUCKET)
    .upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  if (up.error) return { id, error: up.error.message };
  const ins = await supabase.from("invoice_scans").insert({
    id,
    org_id: orgId,
    shop_id: shopId,
    storage_path: path,
    original_filename: file.name,
    mime: file.type || null,
    status: "pending",
  });
  if (ins.error) return { id, error: ins.error.message };
  return { id };
}

/** Patch a scan row (status + the extracted json / error / posted GRN). */
export async function updateScan(
  id: string,
  patch: Partial<{ status: ScanStatus; extracted_json: unknown; vendor_guess: string | null; error: string | null; purchase_id: string }>,
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

/** Remove a scan from the audit trail: delete its stored file, then its row. Does
 *  NOT unwind a posted GRN — only the scan record + uploaded file are cleared (RLS
 *  delete policies, migration 0049). File removal is best-effort (a missing object
 *  is not fatal); the row delete is what the caller cares about. */
export async function deleteScan(id: string, storagePath: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not connected." };
  await supabase.storage.from(INVOICE_SCANS_BUCKET).remove([storagePath]);
  const { error } = await supabase.from("invoice_scans").delete().eq("id", id);
  return error ? { error: error.message } : {};
}
