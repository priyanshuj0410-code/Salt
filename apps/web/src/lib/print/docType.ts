/**
 * The kind of document a print run produces. Sales-side documents (tax invoice,
 * cash memo, B2B) come off the counter; the notes (credit / debit / sales return)
 * are produced by the returns flow. Each changes the heading, whether the rule-46
 * tax-invoice formalities show, and whether a reference-to-original line appears.
 * See [SALT-096].
 */
export type DocType =
  | "tax-invoice"
  | "cash-memo"
  | "b2b-invoice"
  | "credit-note"
  | "debit-note"
  | "sales-return";

export interface DocMeta {
  /** Heading printed at the top of the document. */
  title: string;
  /** Short label for the popup's document switcher. */
  label: string;
  /** A GST tax document → show the copy label + rule-46 declaration. */
  taxDoc: boolean;
  /** A note / return → show the reference-to-original line. */
  isNote: boolean;
}

export const DOC_META: Record<DocType, DocMeta> = {
  "tax-invoice": { title: "TAX INVOICE", label: "Tax Invoice", taxDoc: true, isNote: false },
  "cash-memo": { title: "CASH MEMO", label: "Cash Memo", taxDoc: false, isNote: false },
  "b2b-invoice": { title: "TAX INVOICE", label: "B2B", taxDoc: true, isNote: false },
  "credit-note": { title: "CREDIT NOTE", label: "Credit Note", taxDoc: true, isNote: true },
  "debit-note": { title: "DEBIT NOTE", label: "Debit Note", taxDoc: true, isNote: true },
  "sales-return": { title: "SALES RETURN", label: "Sales Return", taxDoc: false, isNote: true },
};

/** Forward-sale documents a cashier may pick at print time (popup switcher). */
export const SALE_DOC_TYPES: readonly DocType[] = ["tax-invoice", "cash-memo", "b2b-invoice"];

export const DEFAULT_DOC: DocType = "tax-invoice";

/** Default document for a counter sale: a registered buyer (GSTIN) → B2B, else a plain tax invoice. */
export function deriveDocType(hasBuyerGstin: boolean): DocType {
  return hasBuyerGstin ? "b2b-invoice" : "tax-invoice";
}

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && v in DOC_META;
}
