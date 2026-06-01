import { supabase } from "./supabase";
import { formatPaise } from "./currency";
import { normalizePhoneForWa, whatsappUrl, reminderMessage } from "./collection";
import { buildBillShareText } from "./billShare";

/**
 * WhatsApp send infrastructure (SALT-107) — the integrations-owned, canonical
 * home for everything WhatsApp.
 *
 * Two transports behind one seam:
 *   1. **Click-to-chat** (default, zero-config): a `wa.me` deep link the user
 *      taps to open WhatsApp with the message pre-filled. Works today on every
 *      device with no credentials and no server.
 *   2. **Business (Cloud) API** (opt-in): for automated server-side sending.
 *      The Meta token + phone-number-id are secrets, so they live in the
 *      `whatsapp-send` Supabase Edge Function; the client only knows its URL.
 *      When it is not configured, `sendWhatsApp` transparently falls back to
 *      click-to-chat — nothing breaks without deployment.
 *
 * The low-level `wa.me` primitives (`normalizePhoneForWa`, `whatsappUrl`) and
 * the two oldest message builders (`reminderMessage`, `buildBillShareText`)
 * already lived in `lib/collection.ts` / `lib/billShare.ts` and are reused
 * verbatim here so wording never drifts; new code should import them from this
 * module so there is a single integrations entry point.
 */

// ── transport primitives (re-exported so callers have one import home) ────────
export { normalizePhoneForWa, whatsappUrl } from "./collection";

// ── connection config (localStorage; holds no secret — the token is server-side)
const CONFIG_KEY = "salt.whatsapp.config";

export interface WhatsAppConfig {
  /** Business display name used as the default sender in templates. */
  senderName: string;
  /** When true (and an endpoint is set), `sendWhatsApp` uses the Business API. */
  cloudApiEnabled: boolean;
  /** URL of the `whatsapp-send` edge function that forwards to the Graph API. */
  endpointUrl: string;
}

const DEFAULT_CONFIG: WhatsAppConfig = {
  senderName: "",
  cloudApiEnabled: false,
  endpointUrl: "",
};

export function getWhatsAppConfig(): WhatsAppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<WhatsAppConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveWhatsAppConfig(patch: Partial<WhatsAppConfig>): WhatsAppConfig {
  const next = { ...getWhatsAppConfig(), ...patch };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — config just won't persist */
  }
  return next;
}

/** Whether the Business API path is actually usable right now. */
export function isCloudApiReady(cfg: WhatsAppConfig = getWhatsAppConfig()): boolean {
  return cfg.cloudApiEnabled && cfg.endpointUrl.trim().length > 0;
}

// ── Cloud (Graph) API payloads ───────────────────────────────────────────────
// Meta WhatsApp Cloud API message shapes (graph.facebook.com/<ver>/<id>/messages).
const GRAPH_DEFAULT_LANG = "en";

export interface CloudApiTextPayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { preview_url: boolean; body: string };
}

/** A free-form text message (allowed inside the 24h customer-service window). */
export function buildTextPayload(toWaPhone: string, body: string): CloudApiTextPayload {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaPhone,
    type: "text",
    text: { preview_url: false, body },
  };
}

export interface CloudApiTemplatePayload {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>;
  };
}

/**
 * A pre-approved template message (required for business-initiated sends
 * outside the 24h window). `params` fills the {{1}}, {{2}}… body placeholders.
 */
export function buildTemplatePayload(
  toWaPhone: string,
  name: string,
  params: string[],
  langCode: string = GRAPH_DEFAULT_LANG,
): CloudApiTemplatePayload {
  return {
    messaging_product: "whatsapp",
    to: toWaPhone,
    type: "template",
    template: {
      name,
      language: { code: langCode },
      components: params.length
        ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };
}

// ── unified send ─────────────────────────────────────────────────────────────
export type SendChannel = "cloud-api" | "click-to-chat";

export interface SendResult {
  ok: boolean;
  channel: SendChannel;
  /** For the click-to-chat channel: the wa.me URL the caller should open. */
  url?: string;
  error?: string;
}

/**
 * Send a plain-text WhatsApp message. Uses the Business API when configured,
 * otherwise returns a click-to-chat URL for the caller to `window.open`.
 */
export async function sendWhatsApp(opts: {
  phone: string | null | undefined;
  text: string;
}): Promise<SendResult> {
  const waPhone = normalizePhoneForWa(opts.phone);
  if (!waPhone) return { ok: false, channel: "click-to-chat", error: "No valid mobile number." };

  const cfg = getWhatsAppConfig();
  if (isCloudApiReady(cfg)) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = (await supabase?.auth.getSession())?.data.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(cfg.endpointUrl.trim(), {
        method: "POST",
        headers,
        body: JSON.stringify(buildTextPayload(waPhone, opts.text)),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { ok: false, channel: "cloud-api", error: `Send failed (${res.status}). ${detail.slice(0, 180)}` };
      }
      return { ok: true, channel: "cloud-api" };
    } catch (e) {
      return { ok: false, channel: "cloud-api", error: e instanceof Error ? e.message : "Network error." };
    }
  }

  return { ok: true, channel: "click-to-chat", url: whatsappUrl(waPhone, opts.text) };
}

// ── template registry ────────────────────────────────────────────────────────
export type WaAudience = "customer" | "vendor";

export interface WaField {
  key: string;
  label: string;
  sample: string;
  kind?: "text" | "amount" | "date";
}

export interface WaTemplate {
  id: string;
  label: string;
  description: string;
  audience: WaAudience;
  /** Suggested name to register in WhatsApp Manager for the Business API path. */
  cloudTemplateName: string;
  fields: WaField[];
  /** Render the message body from human-entered field values. */
  build: (values: Record<string, string>) => string;
}

/** Parse a rupee string ("12,500.50") into integer paise. */
function rupeesToPaise(s: string): number {
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const val = (values: Record<string, string>, k: string): string => values[k] ?? "";

/** Account-statement message (new — no prior builder existed). */
export function ledgerStatementMessage(v: {
  partyName: string;
  shopName?: string | null;
  periodLabel: string;
  openingPaise: number;
  billedPaise: number;
  paidPaise: number;
  closingPaise: number;
}): string {
  const from = v.shopName?.trim() ? ` from ${v.shopName.trim()}` : "";
  return [
    `Dear ${v.partyName},`,
    "",
    `Your account statement${from} for ${v.periodLabel}:`,
    `Opening balance: ${formatPaise(v.openingPaise)}`,
    `Billed: ${formatPaise(v.billedPaise)}`,
    `Paid: ${formatPaise(v.paidPaise)}`,
    `Closing balance: ${formatPaise(v.closingPaise)}`,
    "",
    v.closingPaise > 0
      ? "Kindly arrange payment of the closing balance at your convenience. Thank you."
      : "Your account is settled in full. Thank you!",
  ].join("\n");
}

/** Near-expiry return-claim message to a vendor (new). */
export function nearExpiryVendorMessage(v: {
  vendorName: string;
  shopName?: string | null;
  itemName: string;
  batchNo: string;
  expiryLabel: string;
  qty: string;
}): string {
  const from = v.shopName?.trim() ? `, ${v.shopName.trim()},` : "";
  return [
    `Dear ${v.vendorName},`,
    "",
    `We${from} have near-expiry stock and would like to initiate a return claim:`,
    `Item: ${v.itemName}`,
    `Batch: ${v.batchNo} · Expiry: ${v.expiryLabel}`,
    `Quantity: ${v.qty}`,
    "",
    "Please advise on the return / credit-note process. Thank you.",
  ].join("\n");
}

/**
 * The four Module-14 WhatsApp use cases. Invoice-share and payment-reminder
 * delegate to the existing canonical builders so the wording stays in one place.
 */
export const WHATSAPP_TEMPLATES: WaTemplate[] = [
  {
    id: "invoice_share",
    label: "Invoice share",
    description: "Send a customer the summary of a saved bill.",
    audience: "customer",
    cloudTemplateName: "invoice_share",
    fields: [
      { key: "shopName", label: "Shop name", sample: "Santosh Medical" },
      { key: "ref", label: "Bill ref", sample: "INV/2026-27/0042" },
      { key: "date", label: "Bill date", sample: "1 Jun 2026", kind: "date" },
      { key: "total", label: "Total (₹)", sample: "2450.00", kind: "amount" },
      { key: "paid", label: "Paid (₹)", sample: "0.00", kind: "amount" },
      { key: "dueDate", label: "Due date (optional)", sample: "15 Jun 2026", kind: "date" },
    ],
    build: (v) =>
      buildBillShareText({
        shopName: val(v, "shopName"),
        ref: val(v, "ref"),
        dateLabel: val(v, "date"),
        totalPaise: rupeesToPaise(val(v, "total")),
        paidPaise: rupeesToPaise(val(v, "paid")),
        dueDateLabel: val(v, "dueDate").trim() || null,
      }),
  },
  {
    id: "payment_reminder",
    label: "Payment reminder",
    description: "Remind a customer of their outstanding balance, with an optional UPI pay link.",
    audience: "customer",
    cloudTemplateName: "payment_reminder",
    fields: [
      { key: "partyName", label: "Customer name", sample: "Ramesh Medical" },
      { key: "shopName", label: "Shop name", sample: "Santosh Medical" },
      { key: "amountDue", label: "Amount due (₹)", sample: "38500.00", kind: "amount" },
      { key: "vpa", label: "Shop UPI ID (optional)", sample: "santoshmedical@okhdfcbank" },
    ],
    build: (v) =>
      reminderMessage({
        partyName: val(v, "partyName"),
        shopName: val(v, "shopName"),
        duePaise: rupeesToPaise(val(v, "amountDue")),
        vpa: val(v, "vpa").trim() || null,
      }),
  },
  {
    id: "ledger_statement",
    label: "Ledger statement",
    description: "Send a customer their account statement for a period.",
    audience: "customer",
    cloudTemplateName: "ledger_statement",
    fields: [
      { key: "partyName", label: "Customer name", sample: "Ramesh Medical" },
      { key: "shopName", label: "Shop name", sample: "Santosh Medical" },
      { key: "periodLabel", label: "Period", sample: "Apr–Jun 2026" },
      { key: "opening", label: "Opening (₹)", sample: "12000.00", kind: "amount" },
      { key: "billed", label: "Billed (₹)", sample: "65000.00", kind: "amount" },
      { key: "paid", label: "Paid (₹)", sample: "38500.00", kind: "amount" },
      { key: "closing", label: "Closing (₹)", sample: "38500.00", kind: "amount" },
    ],
    build: (v) =>
      ledgerStatementMessage({
        partyName: val(v, "partyName"),
        shopName: val(v, "shopName"),
        periodLabel: val(v, "periodLabel"),
        openingPaise: rupeesToPaise(val(v, "opening")),
        billedPaise: rupeesToPaise(val(v, "billed")),
        paidPaise: rupeesToPaise(val(v, "paid")),
        closingPaise: rupeesToPaise(val(v, "closing")),
      }),
  },
  {
    id: "near_expiry_vendor",
    label: "Near-expiry return (vendor)",
    description: "Ask a distributor to initiate a return claim for near-expiry stock.",
    audience: "vendor",
    cloudTemplateName: "near_expiry_return",
    fields: [
      { key: "vendorName", label: "Vendor name", sample: "MedPlus Distributors" },
      { key: "shopName", label: "Shop name", sample: "Santosh Medical" },
      { key: "itemName", label: "Item", sample: "Cephalexin 500mg" },
      { key: "batchNo", label: "Batch", sample: "CEP2410" },
      { key: "expiryLabel", label: "Expiry", sample: "Aug 2026", kind: "date" },
      { key: "qty", label: "Quantity", sample: "500 strips" },
    ],
    build: (v) =>
      nearExpiryVendorMessage({
        vendorName: val(v, "vendorName"),
        shopName: val(v, "shopName"),
        itemName: val(v, "itemName"),
        batchNo: val(v, "batchNo"),
        expiryLabel: val(v, "expiryLabel"),
        qty: val(v, "qty"),
      }),
  },
];

/** Sample field values for a template, keyed by field. */
export function templateSample(t: WaTemplate): Record<string, string> {
  return Object.fromEntries(t.fields.map((f) => [f.key, f.sample]));
}

/** Field values in declared order — the param list for a Cloud API template. */
export function templateParams(t: WaTemplate, values: Record<string, string>): string[] {
  return t.fields.map((f) => val(values, f.key));
}
