/**
 * GSTR-1 (outward supplies return) aggregation — pure, no Supabase.
 *
 * The CGST/SGST/IGST split is decided and stored at write time by the
 * `create_sales_invoice` RPC (intra-state ⇒ CGST+SGST, inter-state ⇒ IGST; see
 * `lib/orders.ts` and `supabase/proposed/0018_sales.sql`), persisted on every
 * `sales_invoices` row AND every `sale_lines` row. So GSTR-1 is a straight
 * aggregation of pre-taxed rows — never a back-calculation. The page fetches the
 * rows and passes them here, which keeps this unit-smoke-testable.
 *
 * All money is integer **paise**. The GSTN JSON the portal ingests wants rupee
 * amounts (2 decimals), so {@link buildGstr1Json} converts paise → rupees.
 *
 * Scope (SALT-002): B2B, B2CL/B2CS, and HSN summary for one shop's GSTIN and one
 * month. Credit notes (CDNR) are deferred until the Returns module exists.
 */

/** A B2C inter-state invoice above ₹2.5 lakh is itemised in B2CL; the rest fall into B2CS. */
export const B2CL_THRESHOLD_PAISE = 25_000_000;

// ---- Input rows (shape returned by the page's PostgREST query) --------------

/** One `sales_invoices` row with its party embedded (null party = walk-in). */
export interface Gstr1InvoiceRow {
  id: string;
  invoice_no: string | null;
  invoice_date: string; // 'YYYY-MM-DD'
  is_interstate: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  party: { gstin: string | null; name: string | null; state_code: string | null } | null;
}

/** One `sale_lines` row with its item's HSN embedded; `invoice_id` ties it to a {@link Gstr1InvoiceRow}. */
export interface Gstr1LineRow {
  invoice_id: string;
  qty: number;
  gst_rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  hsn: string | null;
}

// ---- Aggregated output ------------------------------------------------------

/** A bucket of tax totals, all in paise. `total` = taxable + all three taxes. */
export interface TaxTotals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** Per-rate slice of an invoice or aggregate (`rate` is the GST %, e.g. 5/12/18). */
export interface RateSlice extends TaxTotals {
  rate: number;
}

/** A single B2B invoice, broken into its rate slices. */
export interface B2bInvoice extends TaxTotals {
  invoiceNo: string;
  date: string; // 'YYYY-MM-DD'
  pos: string; // place of supply (recipient state code)
  rates: RateSlice[];
}

/** All B2B invoices for one recipient GSTIN. */
export interface B2bParty extends TaxTotals {
  gstin: string;
  name: string;
  invoices: B2bInvoice[];
}

/** A B2C inter-state invoice ≥ ₹2.5L, itemised by rate (B2CL). */
export interface B2clInvoice extends TaxTotals {
  invoiceNo: string;
  date: string;
  pos: string;
  rates: RateSlice[];
}

/** A B2C-small aggregate row, keyed by place of supply + supply type + rate. */
export interface B2csRow extends RateSlice {
  pos: string;
  supplyType: "INTRA" | "INTER";
}

/** An HSN-summary row, keyed by HSN code + rate, with quantity. */
export interface HsnRow extends RateSlice {
  hsn: string;
  qty: number;
}

/** The complete GSTR-1 summary for a shop + period. */
export interface Gstr1Summary {
  period: string; // 'YYYY-MM'
  b2b: B2bParty[];
  b2cl: B2clInvoice[];
  b2cs: B2csRow[];
  hsn: HsnRow[];
  totals: TaxTotals; // summed over all lines
  invoiceCount: number;
}

// ---- Helpers ----------------------------------------------------------------

function emptyTotals(): TaxTotals {
  return { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
}

/** Add a line's (or invoice's) tax amounts into an accumulator, in place. */
function addInto(acc: TaxTotals, r: { taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number }) {
  acc.taxablePaise += r.taxable_paise;
  acc.cgstPaise += r.cgst_paise;
  acc.sgstPaise += r.sgst_paise;
  acc.igstPaise += r.igst_paise;
  acc.totalPaise += r.taxable_paise + r.cgst_paise + r.sgst_paise + r.igst_paise;
}

type InvoiceKind = "b2b" | "b2cl" | "b2cs";

interface InvoiceMeta {
  kind: InvoiceKind;
  pos: string;
  gstin: string;
  name: string;
  invoiceNo: string;
  date: string;
  supplyType: "INTRA" | "INTER";
}

/** Fallback label when an invoice has no number yet (mirrors /bills). */
function invoiceLabel(inv: Gstr1InvoiceRow): string {
  return inv.invoice_no ?? `#${inv.id.slice(0, 8)}`;
}

/**
 * Classify one invoice: B2B if the recipient has a GSTIN; otherwise B2C, split
 * into B2CL (inter-state and ≥ ₹2.5L) vs B2CS. Place of supply is the recipient's
 * state, falling back to the shop's own state for walk-ins / missing state.
 */
function classify(inv: Gstr1InvoiceRow, shopStateCode: string): InvoiceMeta {
  const gstin = inv.party?.gstin?.trim() ?? "";
  const pos = inv.party?.state_code?.trim() || shopStateCode;
  const supplyType = inv.is_interstate ? "INTER" : "INTRA";
  let kind: InvoiceKind;
  if (gstin) kind = "b2b";
  else if (inv.is_interstate && inv.total_paise >= B2CL_THRESHOLD_PAISE) kind = "b2cl";
  else kind = "b2cs";
  return { kind, pos, gstin, name: inv.party?.name?.trim() || "", invoiceNo: invoiceLabel(inv), date: inv.invoice_date, supplyType };
}

/** Sort rate slices ascending for stable display/export. */
function sortRates<T extends { rate: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.rate - b.rate);
}

// ---- The builder ------------------------------------------------------------

/**
 * Build the GSTR-1 summary from a period's invoices and their lines.
 *
 * Section breakdowns (B2B/B2CL/B2CS/HSN) and the headline totals are all derived
 * from the **lines**, so they reconcile exactly; `invoiceCount` comes from the
 * invoices. `shopStateCode` is the filer's origin state (place-of-supply fallback).
 */
export function buildGstr1(
  period: string,
  shopStateCode: string,
  invoices: Gstr1InvoiceRow[],
  lines: Gstr1LineRow[],
): Gstr1Summary {
  const meta = new Map<string, InvoiceMeta>();
  for (const inv of invoices) meta.set(inv.id, classify(inv, shopStateCode));

  // B2B: party gstin → invoice id → rate → totals
  const b2bParties = new Map<string, { name: string; invoices: Map<string, { meta: InvoiceMeta; rates: Map<number, RateSlice> }> }>();
  // B2CL: invoice id → rate → totals
  const b2clInvoices = new Map<string, { meta: InvoiceMeta; rates: Map<number, RateSlice> }>();
  // B2CS: `${pos}|${supplyType}|${rate}` → row
  const b2csRows = new Map<string, B2csRow>();
  // HSN: `${hsn}|${rate}` → row
  const hsnRows = new Map<string, HsnRow>();
  const totals = emptyTotals();

  for (const line of lines) {
    const m = meta.get(line.invoice_id);
    if (!m) continue; // line whose invoice fell outside the period/filter
    addInto(totals, line);

    // HSN summary spans every line, B2B and B2C alike.
    const hsn = line.hsn?.trim() || "—";
    const hKey = `${hsn}|${line.gst_rate}`;
    let hRow = hsnRows.get(hKey);
    if (!hRow) {
      hRow = { hsn, rate: line.gst_rate, qty: 0, ...emptyTotals() };
      hsnRows.set(hKey, hRow);
    }
    hRow.qty += line.qty;
    addInto(hRow, line);

    if (m.kind === "b2b") {
      let party = b2bParties.get(m.gstin);
      if (!party) {
        party = { name: m.name, invoices: new Map() };
        b2bParties.set(m.gstin, party);
      }
      let inv = party.invoices.get(line.invoice_id);
      if (!inv) {
        inv = { meta: m, rates: new Map() };
        party.invoices.set(line.invoice_id, inv);
      }
      addRateSlice(inv.rates, line);
    } else if (m.kind === "b2cl") {
      let inv = b2clInvoices.get(line.invoice_id);
      if (!inv) {
        inv = { meta: m, rates: new Map() };
        b2clInvoices.set(line.invoice_id, inv);
      }
      addRateSlice(inv.rates, line);
    } else {
      const key = `${m.pos}|${m.supplyType}|${line.gst_rate}`;
      let row = b2csRows.get(key);
      if (!row) {
        row = { pos: m.pos, supplyType: m.supplyType, rate: line.gst_rate, ...emptyTotals() };
        b2csRows.set(key, row);
      }
      addInto(row, line);
    }
  }

  return {
    period,
    b2b: buildB2bParties(b2bParties),
    b2cl: buildRateInvoices(b2clInvoices),
    b2cs: sortRows(Array.from(b2csRows.values()), (r) => [r.pos, r.supplyType, r.rate]),
    hsn: sortRows(Array.from(hsnRows.values()), (r) => [r.hsn, r.rate]),
    totals,
    invoiceCount: invoices.length,
  };
}

function addRateSlice(rates: Map<number, RateSlice>, line: Gstr1LineRow) {
  let slice = rates.get(line.gst_rate);
  if (!slice) {
    slice = { rate: line.gst_rate, ...emptyTotals() };
    rates.set(line.gst_rate, slice);
  }
  addInto(slice, line);
}

function rollUp(items: TaxTotals[]): TaxTotals {
  const t = emptyTotals();
  for (const r of items) {
    t.taxablePaise += r.taxablePaise;
    t.cgstPaise += r.cgstPaise;
    t.sgstPaise += r.sgstPaise;
    t.igstPaise += r.igstPaise;
    t.totalPaise += r.totalPaise;
  }
  return t;
}

function buildB2bParties(src: Map<string, { name: string; invoices: Map<string, { meta: InvoiceMeta; rates: Map<number, RateSlice> }> }>): B2bParty[] {
  const out: B2bParty[] = [];
  for (const [gstin, party] of src) {
    const invoices = buildRateInvoices(party.invoices);
    out.push({ gstin, name: party.name, invoices, ...rollUp(invoices) });
  }
  return out.sort((a, b) => a.gstin.localeCompare(b.gstin));
}

function buildRateInvoices(src: Map<string, { meta: InvoiceMeta; rates: Map<number, RateSlice> }>): (B2bInvoice & B2clInvoice)[] {
  const out: (B2bInvoice & B2clInvoice)[] = [];
  for (const { meta: m, rates } of src.values()) {
    const slices = sortRates(Array.from(rates.values()));
    out.push({ invoiceNo: m.invoiceNo, date: m.date, pos: m.pos, rates: slices, ...rollUp(slices) });
  }
  return out.sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));
}

/** Generic multi-key ascending sort (numbers and strings). */
function sortRows<T>(rows: T[], key: (r: T) => (string | number)[]): T[] {
  return rows.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

// ---- Exports for the portal -------------------------------------------------

/** paise → rupees, 2 decimals, as the GSTN schema expects. */
function rupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' (GSTN invoice date format). */
function gstnDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** 'YYYY-MM' → 'MMYYYY' (GSTN filing period `fp`). */
function gstnPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${m}${y}`;
}

function itms(rates: RateSlice[]) {
  return rates.map((r, i) => ({
    num: i + 1,
    itm_det: {
      rt: r.rate,
      txval: rupees(r.taxablePaise),
      iamt: rupees(r.igstPaise),
      camt: rupees(r.cgstPaise),
      samt: rupees(r.sgstPaise),
    },
  }));
}

/**
 * Build the GSTN-compatible GSTR-1 JSON for the portal / offline tool. Covers the
 * b2b, b2cl, b2cs and hsn sections. `gstin` is the filing shop's own GSTIN.
 */
export function buildGstr1Json(summary: Gstr1Summary, gstin: string) {
  return {
    gstin,
    fp: gstnPeriod(summary.period),
    b2b: summary.b2b.map((p) => ({
      ctin: p.gstin,
      inv: p.invoices.map((inv) => ({
        inum: inv.invoiceNo,
        idt: gstnDate(inv.date),
        val: rupees(inv.totalPaise),
        pos: inv.pos,
        rchrg: "N",
        inv_typ: "R",
        itms: itms(inv.rates),
      })),
    })),
    b2cl: summary.b2cl.map((inv) => ({
      pos: inv.pos,
      inv: [{ inum: inv.invoiceNo, idt: gstnDate(inv.date), val: rupees(inv.totalPaise), itms: itms(inv.rates) }],
    })),
    b2cs: summary.b2cs.map((r) => ({
      sply_ty: r.supplyType,
      pos: r.pos,
      typ: "OE",
      rt: r.rate,
      txval: rupees(r.taxablePaise),
      camt: rupees(r.cgstPaise),
      samt: rupees(r.sgstPaise),
      iamt: rupees(r.igstPaise),
    })),
    hsn: {
      data: summary.hsn.map((r, i) => ({
        num: i + 1,
        hsn_sc: r.hsn,
        rt: r.rate,
        qty: r.qty,
        txval: rupees(r.taxablePaise),
        iamt: rupees(r.igstPaise),
        camt: rupees(r.cgstPaise),
        samt: rupees(r.sgstPaise),
      })),
    },
  };
}

/** A flat CSV across all sections (a spreadsheet fallback to the GSTN JSON). */
export function gstr1ToCsv(summary: Gstr1Summary): string {
  const head = ["section", "key1", "key2", "rate", "qty", "taxable", "cgst", "sgst", "igst", "total"];
  const rows: (string | number)[][] = [];
  const money = (p: number) => (Math.round(p) / 100).toFixed(2);
  const push = (section: string, k1: string, k2: string, r: RateSlice & { qty?: number }) =>
    rows.push([section, k1, k2, r.rate, r.qty ?? "", money(r.taxablePaise), money(r.cgstPaise), money(r.sgstPaise), money(r.igstPaise), money(r.totalPaise)]);

  for (const p of summary.b2b) for (const inv of p.invoices) for (const r of inv.rates) push("B2B", p.gstin, inv.invoiceNo, r);
  for (const inv of summary.b2cl) for (const r of inv.rates) push("B2CL", inv.pos, inv.invoiceNo, r);
  for (const r of summary.b2cs) push("B2CS", r.pos, r.supplyType, r);
  for (const r of summary.hsn) push("HSN", r.hsn, "", r);

  return [head, ...rows].map((cols) => cols.map(csvCell).join(",")).join("\n");
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
