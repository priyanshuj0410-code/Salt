import { supabase } from "./supabase";
import { formatPaise } from "./currency";
import { normalizePhoneForWa } from "./collection";

/**
 * Razorpay integration (SALT-108) — payment-link infrastructure.
 *
 * The collections play (product-modules §7): generate a hosted payment link for
 * a customer's outstanding and send it (over the WhatsApp seam from SALT-107);
 * a webhook then auto-applies the receipt to their ledger.
 *
 * Razorpay's secret key can only be used server-side, so link creation goes
 * through the `razorpay-link` Supabase Edge Function, which holds
 * `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` and Basic-auths to the Razorpay API.
 * The client never sees the secret. When the gateway is not configured,
 * `createPaymentLink` returns a clear error rather than failing silently — the
 * existing UPI deep link (lib/collection.ts `upiPayUrl`) remains the zero-setup
 * collection path. Money is integer paise, which is exactly Razorpay's unit.
 *
 * Out of scope here (filed as follow-ups): the webhook → `record_payment`
 * auto-reconciliation (payments/DB modules) and wiring link-creation buttons
 * into the parties/payments screens.
 */

// ── connection config (localStorage; key_id is publishable, the secret is server-side)
const CONFIG_KEY = "salt.razorpay.config";

export interface RazorpayConfig {
  /** Publishable key id (rzp_live_… / rzp_test_…) — safe on the client. */
  keyId: string;
  /** When true (and an endpoint is set), link creation calls the gateway. */
  enabled: boolean;
  /** URL of the `razorpay-link` edge function. */
  endpointUrl: string;
}

const DEFAULT_CONFIG: RazorpayConfig = { keyId: "", enabled: false, endpointUrl: "" };

export function getRazorpayConfig(): RazorpayConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<RazorpayConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveRazorpayConfig(patch: Partial<RazorpayConfig>): RazorpayConfig {
  const next = { ...getRazorpayConfig(), ...patch };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — config just won't persist */
  }
  return next;
}

/** Whether live link creation is actually wired up. */
export function isRazorpayReady(cfg: RazorpayConfig = getRazorpayConfig()): boolean {
  return cfg.enabled && cfg.endpointUrl.trim().length > 0;
}

/** Razorpay's `customer.contact` wants E.164 with the leading +. */
export function razorpayContact(phone: string | null | undefined): string | null {
  const wa = normalizePhoneForWa(phone);
  return wa ? `+${wa}` : null;
}

// ── payment-link request ──────────────────────────────────────────────────────
export interface PaymentLinkInput {
  amountPaise: number;
  description: string;
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Stored in Razorpay `notes` so the webhook can match the receipt back. */
  referenceId?: string | null;
}

export interface RazorpayPaymentLinkRequest {
  amount: number;
  currency: "INR";
  accept_partial: boolean;
  description: string;
  customer: { name?: string; contact?: string; email?: string };
  notify: { sms: boolean; email: boolean };
  reminder_enable: boolean;
  notes?: Record<string, string>;
}

/** Build the Razorpay Payment Links API body from a collection request. */
export function buildPaymentLinkRequest(input: PaymentLinkInput): RazorpayPaymentLinkRequest {
  const customer: RazorpayPaymentLinkRequest["customer"] = {};
  if (input.customerName?.trim()) customer.name = input.customerName.trim();
  const contact = razorpayContact(input.phone);
  if (contact) customer.contact = contact;
  if (input.email?.trim()) customer.email = input.email.trim();

  const notes: Record<string, string> = {};
  if (input.referenceId?.trim()) notes.reference_id = input.referenceId.trim();

  const req: RazorpayPaymentLinkRequest = {
    amount: Math.max(0, Math.round(input.amountPaise)),
    currency: "INR",
    accept_partial: false,
    description: input.description.trim() || "Payment",
    customer,
    notify: { sms: Boolean(contact), email: Boolean(customer.email) },
    reminder_enable: true,
  };
  if (Object.keys(notes).length) req.notes = notes;
  return req;
}

// ── create (via the edge function) ────────────────────────────────────────────
export interface CreateLinkResult {
  ok: boolean;
  shortUrl?: string;
  id?: string;
  error?: string;
}

interface RazorpayLinkResponse {
  id?: string;
  short_url?: string;
  error?: { description?: string };
}

export async function createPaymentLink(input: PaymentLinkInput): Promise<CreateLinkResult> {
  const cfg = getRazorpayConfig();
  if (!isRazorpayReady(cfg)) {
    return { ok: false, error: "Razorpay is not configured. Set it up in the connection panel above." };
  }
  if (input.amountPaise <= 0) return { ok: false, error: "Amount must be greater than zero." };

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(cfg.endpointUrl.trim(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildPaymentLinkRequest(input)),
    });
    const body = (await res.json().catch(() => ({}))) as RazorpayLinkResponse;
    if (!res.ok) {
      return { ok: false, error: body.error?.description || `Create failed (${res.status}).` };
    }
    return { ok: true, shortUrl: body.short_url, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
}

/** A share-ready message carrying the payment link (for the WhatsApp seam). */
export function paymentLinkMessage(opts: {
  customerName?: string | null;
  shopName?: string | null;
  amountPaise: number;
  shortUrl: string;
}): string {
  const greeting = opts.customerName?.trim() ? `Dear ${opts.customerName.trim()},` : "Hello,";
  const from = opts.shopName?.trim() ? ` to ${opts.shopName.trim()}` : "";
  return [
    greeting,
    "",
    `Please pay ${formatPaise(opts.amountPaise)}${from} using this secure link:`,
    opts.shortUrl,
    "",
    "Thank you!",
  ].join("\n");
}
