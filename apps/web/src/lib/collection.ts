import { formatPaise } from "./currency";
import type { AgingBuckets } from "./aging";

/**
 * Collection helpers — turn a party's outstanding into a WhatsApp payment
 * reminder, optionally carrying a UPI pay link when the shop has a VPA set.
 */

/**
 * Best-effort normalisation of a free-text phone into the digits wa.me wants
 * (country code, no +). Returns null when there are too few digits to be a
 * mobile number, so callers can disable the action.
 */
export function normalizePhoneForWa(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) return "91" + digits; // bare Indian mobile
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits; // already carries some country code, best effort
}

/** A polite payment-reminder message: who it is from, the amount due, the
 *  90+ overdue slice when there is one, and a UPI pay link when a vpa is set. */
export function reminderMessage(opts: {
  partyName: string;
  duePaise: number;
  shopName?: string | null;
  receivable?: AgingBuckets;
  /** Shop UPI payee address; when present, a pay link is appended. */
  vpa?: string | null;
}): string {
  const { partyName, duePaise, shopName, receivable, vpa } = opts;
  const from = shopName?.trim() ? ` from ${shopName.trim()}` : "";
  const lines = [
    `Dear ${partyName},`,
    "",
    `This is a payment reminder${from}. Your outstanding balance is ${formatPaise(duePaise)}.`,
  ];
  if (receivable && receivable.d90_plus > 0 && receivable.d90_plus <= duePaise) {
    lines.push(`Of this, ${formatPaise(receivable.d90_plus)} is overdue by more than 90 days.`);
  }
  const payUrl = upiPayUrl({ vpa, payeeName: shopName, amountPaise: duePaise });
  if (payUrl) {
    lines.push("", `Pay instantly via UPI: ${payUrl}`);
  }
  lines.push("", "Kindly arrange the payment at your earliest convenience. Thank you.");
  return lines.join("\n");
}

/**
 * Build a UPI deep link (`upi://pay`) that opens the payer's UPI app pre-filled
 * with the shop as payee and the amount due. UPI expects the amount in rupees,
 * so we convert from integer paise (÷100, 2 decimals). The VPA is URL-safe as-is
 * (alphanumeric + . _ - @); only the free-text payee name needs encoding.
 * Returns null when no VPA is configured, so callers can omit the link.
 */
export function upiPayUrl(opts: {
  vpa?: string | null;
  payeeName?: string | null;
  amountPaise: number;
}): string | null {
  const vpa = opts.vpa?.trim();
  if (!vpa) return null;
  const params = [`pa=${vpa}`];
  const payee = opts.payeeName?.trim();
  if (payee) params.push(`pn=${encodeURIComponent(payee)}`);
  if (opts.amountPaise > 0) params.push(`am=${(opts.amountPaise / 100).toFixed(2)}`);
  params.push("cu=INR");
  return `upi://pay?${params.join("&")}`;
}

/** wa.me deep link that opens WhatsApp with the message pre-filled. */
export function whatsappUrl(waPhone: string, message: string): string {
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
}
