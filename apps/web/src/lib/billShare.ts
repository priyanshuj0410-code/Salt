import { formatPaise } from "./currency";

// SALT-029 — share a saved bill with the customer. The WhatsApp link reuses
// lib/collection (whatsappUrl + normalizePhoneForWa); SMS/email are plain
// protocol deep links so they work on phone and desktop without a dependency.

export interface BillShareInfo {
  shopName: string;
  ref: string;
  dateLabel: string;
  totalPaise: number;
  paidPaise: number;
  dueDateLabel: string | null;
}

/** Concise, channel-neutral bill summary (no markdown, so it reads on SMS/email too). */
export function buildBillShareText(b: BillShareInfo): string {
  const outstanding = b.totalPaise - b.paidPaise;
  const status =
    outstanding > 0
      ? `Balance due: ${formatPaise(outstanding)}${b.dueDateLabel ? ` by ${b.dueDateLabel}` : ""}`
      : "Paid in full";
  return [
    b.shopName,
    `Bill ${b.ref} · ${b.dateLabel}`,
    `Total: ${formatPaise(b.totalPaise)}`,
    status,
    "",
    "Thank you for your visit!",
  ].join("\n");
}

export function buildBillShareSubject(shopName: string, ref: string): string {
  return `Bill ${ref} from ${shopName}`;
}

/** sms: deep link with an optional recipient and a prefilled body. */
export function smsLink(phone: string | null | undefined, body: string): string {
  return `sms:${phone ?? ""}?body=${encodeURIComponent(body)}`;
}

/** mailto: deep link with optional recipient, subject and body. */
export function mailtoLink(email: string | null | undefined, subject: string, body: string): string {
  return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
