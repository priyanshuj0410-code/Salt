/**
 * Bilingual labels for printed bills. Only the *structural* labels (column
 * headers, totals, field names, fixed phrases) are translated — the data (item
 * names, amounts, party names) prints as captured, and the document title (e.g.
 * "TAX INVOICE") stays in English, as is common on Indian bilingual invoices.
 * See [SALT-098].
 */
export type PrintLang = "en" | "hi" | "both";

export const PRINT_LANGS: readonly PrintLang[] = ["en", "hi", "both"];
export const LANG_LABEL: Record<PrintLang, string> = { en: "EN", hi: "हिं", both: "EN+हिं" };
export const DEFAULT_LANG: PrintLang = "en";

export interface Label {
  en: string;
  hi: string;
}

export const LABELS = {
  item: { en: "Item", hi: "वस्तु" },
  qty: { en: "Qty", hi: "मात्रा" },
  mrp: { en: "MRP", hi: "एमआरपी" },
  amt: { en: "Amt", hi: "राशि" },
  amount: { en: "Amount", hi: "राशि" },
  hsn: { en: "HSN", hi: "एचएसएन" },
  disc: { en: "Disc", hi: "छूट" },
  rate: { en: "Rate", hi: "दर" },
  taxable: { en: "Taxable", hi: "कर योग्य" },
  taxableValue: { en: "Taxable value", hi: "कर योग्य मूल्य" },
  gst: { en: "GST", hi: "जीएसटी" },
  cgst: { en: "CGST", hi: "सीजीएसटी" },
  sgst: { en: "SGST", hi: "एसजीएसटी" },
  igst: { en: "IGST", hi: "आईजीएसटी" },
  grossMrp: { en: "Gross (MRP)", hi: "सकल (एमआरपी)" },
  discount: { en: "Discount", hi: "छूट" },
  billDiscount: { en: "Bill discount", hi: "बिल छूट" },
  total: { en: "Total", hi: "कुल" },
  grandTotal: { en: "Grand total", hi: "कुल योग" },
  billTo: { en: "Bill To", hi: "बिल प्रति" },
  placeOfSupply: { en: "Place of supply", hi: "आपूर्ति स्थान" },
  number: { en: "Number", hi: "संख्या" },
  date: { en: "Date", hi: "दिनांक" },
  payment: { en: "Payment", hi: "भुगतान" },
  reverseCharge: { en: "Reverse charge", hi: "रिवर्स चार्ज" },
  taxSummary: { en: "Tax summary", hi: "कर सारांश" },
  amountInWords: { en: "Amount in words", hi: "राशि शब्दों में" },
  declaration: {
    en: "Certified that the particulars given above are true and correct.",
    hi: "प्रमाणित किया जाता है कि ऊपर दिए गए विवरण सत्य एवं सही हैं।",
  },
  thankYou: { en: "Thank you. Get well soon.", hi: "धन्यवाद। शीघ्र स्वस्थ हों।" },
  ref: { en: "Ref", hi: "संदर्भ" },
  customer: { en: "Customer", hi: "ग्राहक" },
} satisfies Record<string, Label>;

export type LabelKey = keyof typeof LABELS;

/** The label text for a language: English, Hindi, or "English / Hindi" for both. */
export function pick(key: LabelKey, lang: PrintLang): string {
  const l = LABELS[key];
  return lang === "hi" ? l.hi : lang === "both" ? `${l.en} / ${l.hi}` : l.en;
}

export function isPrintLang(v: unknown): v is PrintLang {
  return typeof v === "string" && (PRINT_LANGS as readonly string[]).includes(v);
}
