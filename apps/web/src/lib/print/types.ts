import type { Payment } from "../types";
import type { DocType } from "./docType";
import type { PrintLang } from "./i18n";

/**
 * The physical output a bill is laid out for. Two thermal roll widths, a full A4
 * sheet, and a monospace layout for dot-matrix / impact printers (the classic
 * continuous-stationery challan). One renderer emits all of them; the print
 * window switches between them live. See [SALT-094].
 */
export type PrintFormat = "thermal58" | "thermal80" | "a4" | "dotmatrix";

/** Layout family a format renders with — receipt rolls, an A4 sheet, or monospace. */
export type PrintLayout = "receipt" | "sheet" | "mono";

/** Shop header fields printed on the invoice (structural subset of auth `Shop`). */
export interface ShopHeader {
  /** Primary-shop id — keys the per-shop print template. */
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  state_code: string | null;
}

/** Customer contact detail fetched for the bound party (null = walk-in). */
export interface CustomerDetail {
  gstin: string | null;
  phone: string | null;
  state_code: string | null;
}

export interface InvoiceLine {
  name: string;
  pack: string;
  batchNo: string;
  expiry: string;
  qty: number;
  mrpPaise: number;
  netPaise: number;
  gstRate: number;
  /** HSN/SAC code, when the catalogue carries it through to the bill. */
  hsn?: string;
}

export interface InvoicePrintData {
  ref: string;
  dateTime: string;
  shop: ShopHeader;
  customerName: string;
  customer: CustomerDetail | null;
  isInterstate: boolean;
  payment: Payment;
  lines: InvoiceLine[];
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand: number;
  /** For notes / returns: reference to the original document (e.g. "Against Invoice 1A2B3C4D"). */
  reference?: string;
}

/** Options that steer a single print run. */
export interface PrintOptions {
  /** Paper format; defaults to the saved preference. */
  format?: PrintFormat;
  /** Document kind; defaults to one derived from the sale (B2B when the buyer has a GSTIN). */
  docType?: DocType;
  /** Label language; defaults to the saved preference (English). */
  lang?: PrintLang;
}
