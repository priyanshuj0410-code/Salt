import { formatPaise } from "./currency";
import type { AgingBuckets } from "./aging";

/**
 * Collection helpers — turn a party's outstanding into a WhatsApp payment
 * reminder. A real UPI pay link is deferred until a shop UPI VPA setting
 * exists; for now the reminder states the amount and asks for payment.
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
  return digits; // already carries some country code — best effort
}

/** A polite payment-reminder message: who it is from, the amount due, and the
 *  90+ overdue slice when there is one. */
export function reminderMessage(opts: {
  partyName: string;
  duePaise: number;
  shopName?: string | null;
  receivable?: AgingBuckets;
}): string {
  const { partyName, duePaise, shopName, receivable } = opts;
  const from = shopName?.trim() ? ` from ${shopName.trim()}` : "";
  const lines = [
    `Dear ${partyName},`,
    "",
    `This is a payment reminder${from}. Your outstanding balance is ${formatPaise(duePaise)}.`,
  ];
  if (receivable && receivable.d90_plus > 0 && receivable.d90_plus <= duePaise) {
    lines.push(`Of this, ${formatPaise(receivable.d90_plus)} is overdue by more than 90 days.`);
  }
  lines.push("", "Kindly arrange the payment at your earliest convenience. Thank you.");
  return lines.join("\n");
}

/** wa.me deep link that opens WhatsApp with the message pre-filled. */
export function whatsappUrl(waPhone: string, message: string): string {
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
}
