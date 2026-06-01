// Receipt / payment (cash & bank book) history import. Unlike the header+line
// document registers (smartDocument.ts), a payment voucher is a SINGLE flat row:
// one row → one payments record. History loads via DIRECT NON-POSTING inserts —
// the row carries source_doc_no (idempotency, ADR 0011) and posts_effects=false
// (cutover, ADR 0012), so it is a record only and never re-posts the cash/bank ⇄
// party double entry that record_payment would. The opening balance already nets
// every pre-cutover receipt/payment, so imported payments must NOT adjust dues.
// See wiki/architecture/smart-import-extension.md (Phase 4, SALT-150).

import { toPaise, type FieldDef } from "@/lib/smartImport";
import { resolveParty, toIsoDate, type DocCtx } from "@/lib/smartDocument";

export type PaymentDirection = "received" | "paid";

export interface PaymentConfig {
  key: string; // step key, "payments"
  label: string; // "Receipts & payments"
  section: string; // "History"
  table: string; // "payments"
  description: string;
  tip: string;
  fields: FieldDef[]; // flat — must include a "voucher_no" field (the idempotency/dedup key)
}

export const PAYMENT_CONFIG: PaymentConfig = {
  key: "payments",
  label: "Receipts & payments",
  section: "History",
  table: "payments",
  description: "Your receipt / payment history (cash & bank book) — one row per voucher.",
  tip: "Export the cash/bank book or receipt/payment register. Imported as records (no double-entry re-posting); the party must already exist (import ledgers first). Direction comes from a Type column, separate received/paid amount columns, or the default toggle.",
  fields: [
    { key: "voucher_no", label: "Voucher no", required: true, aliases: ["voucher no", "vch no", "voucher", "vch", "receipt no", "payment no", "rcpt no", "doc no", "document no", "entry no", "voucher number", "vno", "ref no"] },
    { key: "date", label: "Date", aliases: ["date", "payment date", "voucher date", "vch date", "receipt date", "txn date", "value date"] },
    { key: "party_name", label: "Party", aliases: ["party", "party name", "account", "ledger", "name", "particulars", "received from", "paid to", "customer", "vendor", "supplier"] },
    { key: "party_gstin", label: "Party GSTIN", aliases: ["gstin", "gst no", "gst number", "party gstin"] },
    { key: "direction", label: "Type (receipt/payment)", aliases: ["type", "voucher type", "vch type", "transaction type", "txn type", "nature", "direction", "receipt/payment"] },
    { key: "mode", label: "Mode", aliases: ["mode", "payment mode", "mode of payment", "through", "instrument", "pay mode", "method", "by"] },
    { key: "amount", label: "Amount", aliases: ["amount", "value", "amt", "net amount", "total", "amount rs"] },
    { key: "amount_received", label: "Received amount", aliases: ["amount received", "received", "receipt amount", "money in", "inflow", "deposit"] },
    { key: "amount_paid", label: "Paid amount", aliases: ["amount paid", "paid amount", "money out", "outflow", "withdrawal"] },
    { key: "reference", label: "Reference (cheque/UTR)", aliases: ["reference", "ref", "cheque no", "chq no", "utr", "utr no", "txn id", "transaction id", "instrument no"] },
    { key: "notes", label: "Narration", aliases: ["narration", "remark", "remarks", "description", "note", "notes"] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

/**
 * Map free-text voucher type → received | paid; null when it can't be told (the
 * caller then falls back to the step's default direction). Dr/Cr is deliberately
 * NOT inferred — it is ambiguous (cash-side vs party-side).
 */
export function normalizeDirection(raw: string): PaymentDirection | null {
  const d = norm(raw);
  if (!d) return null;
  if (/(receipt|received|recv|rcpt|collection|collected|deposit|inflow)/.test(d)) return "received";
  if (/(payment|paid|pay|withdrawal|outflow|expense)/.test(d)) return "paid";
  return null;
}

/**
 * Map free-text mode → one of the live payment modes (never 'adjustment', which
 * record_payment rejects). An unrecognized/blank mode falls back to bank when a
 * reference (cheque/UTR) is present, else cash.
 */
export function normalizeMode(raw: string, hasReference: boolean): string {
  const m = norm(raw);
  if (m) {
    if (m.includes("cash")) return "cash";
    if (/(upi|gpay|googlepay|phonepe|paytm|bhim|qr)/.test(m)) return "upi";
    if (/(cheque|chq|check)/.test(m)) return "cheque";
    if (/(card|pos|swipe)/.test(m)) return "card";
    if (/(neft|rtgs|imps|bank|transfer|online|netbank|tpt)/.test(m)) return "bank";
  }
  return hasReference ? "bank" : "cash";
}

export interface PreparedPayment {
  docNo: string; // source_doc_no
  row: Record<string, unknown>; // DB-ready payments row (minus id/org/shop)
}

export interface PaymentPrepareResult {
  valid: PreparedPayment[];
  quarantined: { docNo: string; reason: string }[];
  skipped: number; // wholly-blank rows skipped (no voucher + no amount)
}

/**
 * Build DB-ready payments rows from a flat register (one row per voucher).
 * - Direction: a non-zero received/paid amount column wins; else the Type column
 *   (normalized); else the step default.
 * - Amount: the matching received/paid column, else the single Amount column.
 * - Party (NOT NULL on payments) resolves GSTIN → name; unresolved → quarantined.
 * - Voucher no is the idempotency key → quarantined when blank, so re-import is
 *   safe (the partial-unique index needs a non-null source_doc_no).
 * - Duplicate voucher numbers within the file are quarantined (the first wins).
 * Money is rupees → paise; nothing is posted (posts_effects=false).
 */
export function preparePayments(
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  ctx: Pick<DocCtx, "partyByGstin" | "partyByName">,
  defaultDirection: PaymentDirection,
): PaymentPrepareResult {
  const get = (row: Record<string, string>, key: string) => {
    const h = mapping[key];
    return h ? (row[h] ?? "").trim() : "";
  };
  const valid: PreparedPayment[] = [];
  const quarantined: PaymentPrepareResult["quarantined"] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const docNo = get(row, "voucher_no");
    const recv = toPaise(get(row, "amount_received"));
    const paid = toPaise(get(row, "amount_paid"));
    const single = toPaise(get(row, "amount"));

    // direction + amount
    let direction: PaymentDirection;
    let amount: number;
    if (recv > 0 && paid > 0) {
      quarantined.push({ docNo: docNo || "(blank)", reason: "Both received and paid amounts on one row" });
      continue;
    } else if (recv > 0) {
      direction = "received";
      amount = recv;
    } else if (paid > 0) {
      direction = "paid";
      amount = paid;
    } else {
      amount = single;
      direction = normalizeDirection(get(row, "direction")) ?? defaultDirection;
    }

    // a wholly blank line (no voucher, no amount) is noise — skip, don't quarantine
    if (!docNo && amount <= 0) {
      skipped++;
      continue;
    }
    if (!docNo) {
      quarantined.push({ docNo: "(blank)", reason: "No voucher no — needed for safe re-import" });
      continue;
    }
    if (amount <= 0) {
      quarantined.push({ docNo, reason: "Zero / blank amount" });
      continue;
    }
    if (seen.has(docNo)) {
      quarantined.push({ docNo, reason: "Duplicate voucher no in file" });
      continue;
    }

    const partyId = resolveParty(get(row, "party_gstin"), get(row, "party_name"), ctx);
    if (!partyId) {
      const nm = get(row, "party_name");
      quarantined.push({ docNo, reason: nm ? `Party not found: ${nm}` : "No party on voucher" });
      continue;
    }

    seen.add(docNo);
    const reference = get(row, "reference");
    const date = toIsoDate(get(row, "date"));
    const out: Record<string, unknown> = {
      party_id: partyId,
      direction,
      mode: normalizeMode(get(row, "mode"), Boolean(reference)),
      amount_paise: amount,
      reference: reference || null,
      notes: get(row, "notes") || null,
      status: "cleared",
      source_system: "marg",
      source_doc_no: docNo,
      posts_effects: false,
      // payment_date omitted when unknown so the column default (current_date) applies
      ...(date ? { payment_date: date } : {}),
    };
    valid.push({ docNo, row: out });
  }

  return { valid, quarantined, skipped };
}
