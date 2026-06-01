/**
 * GSTR-1 (outward supplies return) aggregation — pure, no Supabase.
 *
 * The CGST/SGST/IGST split is decided and stored at write time by the
 * `create_sales_invoice` RPC (intra-state ⇒ CGST+SGST, inter-state ⇒ IGST; see
 * `lib/orders.ts` and `supabase/migrations/0018_sales.sql`), persisted on every
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

// ============================================================================
// GSTR-3B — monthly summary return (output tax − ITC = net payable)
// ============================================================================

/** Tax amounts per head, in paise. */
export interface HeadAmounts {
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** Sales side: invoice-level tax, already split by `create_sales_invoice`. */
export interface Gstr3bOutwardRow {
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

/** Purchase side: eligible ITC, already split by `receive_purchase`. */
export interface Gstr3bItcRow {
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

export interface Gstr3bSummary {
  period: string;
  outwardTaxablePaise: number; // 3.1(a) taxable value of outward supplies
  output: HeadAmounts; // output tax from sales
  itc: HeadAmounts; // eligible ITC from purchases
  balance: HeadAmounts; // netOutput − itc per head (negative = credit available)
  outputTotalPaise: number;
  itcTotalPaise: number; // gross ITC from purchases
  reversalPaise: number; // ITC reversed on write-offs / expiry destruction (Table 4B)
  netItcPaise: number; // itcTotal − reversal — the ITC actually available
  creditNote: HeadAmounts; // outward tax reversed by sales-return credit notes
  netOutput: HeadAmounts; // output − credit notes per head — the net outward liability
  creditNoteTaxablePaise: number;
  creditNoteTotalPaise: number; // credit-note tax across all heads
  netOutputTotalPaise: number; // gross output − credit notes — the actual outward liability
  netPayablePaise: number; // max(0, netOutput − netItc) after full set-off — the cash figure
  creditCarryPaise: number; // max(0, netItc − netOutput) carried forward
  invoiceCount: number;
  purchaseCount: number;
  creditNoteCount: number;
}

const emptyHead = (): HeadAmounts => ({ cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });

/**
 * Build the GSTR-3B summary for a period. Output tax is summed from the period's
 * sales invoices, eligible ITC from its purchases — both already carry the
 * CGST/SGST/IGST split (computed at write time). `netPayable` applies full credit
 * set-off across heads (the standard cash figure); per-head `balance` is exposed
 * for detail. ITC reversal (returns / expired stock) is deferred until the Returns
 * module exists. All money is paise.
 */
export function buildGstr3b(
  period: string,
  sales: Gstr3bOutwardRow[],
  purchases: Gstr3bItcRow[],
  reversalPaise = 0,
  creditNotes: Gstr3bOutwardRow[] = [],
): Gstr3bSummary {
  const output = emptyHead();
  let outwardTaxable = 0;
  for (const s of sales) {
    outwardTaxable += s.taxable_paise;
    output.cgstPaise += s.cgst_paise;
    output.sgstPaise += s.sgst_paise;
    output.igstPaise += s.igst_paise;
  }
  // Sales-return credit notes reverse outward tax (GSTR-3B 3.1(a) is net of them).
  const creditNote = emptyHead();
  let cnTaxable = 0;
  for (const c of creditNotes) {
    cnTaxable += c.taxable_paise;
    creditNote.cgstPaise += c.cgst_paise;
    creditNote.sgstPaise += c.sgst_paise;
    creditNote.igstPaise += c.igst_paise;
  }
  const itc = emptyHead();
  for (const p of purchases) {
    itc.cgstPaise += p.cgst_paise;
    itc.sgstPaise += p.sgst_paise;
    itc.igstPaise += p.igst_paise;
  }
  const netOutput: HeadAmounts = {
    cgstPaise: output.cgstPaise - creditNote.cgstPaise,
    sgstPaise: output.sgstPaise - creditNote.sgstPaise,
    igstPaise: output.igstPaise - creditNote.igstPaise,
  };
  const balance: HeadAmounts = {
    cgstPaise: netOutput.cgstPaise - itc.cgstPaise,
    sgstPaise: netOutput.sgstPaise - itc.sgstPaise,
    igstPaise: netOutput.igstPaise - itc.igstPaise,
  };
  const outputTotal = output.cgstPaise + output.sgstPaise + output.igstPaise;
  const creditNoteTotal = creditNote.cgstPaise + creditNote.sgstPaise + creditNote.igstPaise;
  const netOutputTotal = outputTotal - creditNoteTotal;
  const itcTotal = itc.cgstPaise + itc.sgstPaise + itc.igstPaise;
  const netItc = itcTotal - reversalPaise; // ITC available after the Table 4B reversal
  return {
    period,
    outwardTaxablePaise: outwardTaxable,
    output,
    itc,
    balance,
    outputTotalPaise: outputTotal,
    itcTotalPaise: itcTotal,
    reversalPaise,
    netItcPaise: netItc,
    creditNote,
    netOutput,
    creditNoteTaxablePaise: cnTaxable,
    creditNoteTotalPaise: creditNoteTotal,
    netOutputTotalPaise: netOutputTotal,
    netPayablePaise: Math.max(0, netOutputTotal - netItc),
    creditCarryPaise: Math.max(0, netItc - netOutputTotal),
    invoiceCount: sales.length,
    purchaseCount: purchases.length,
    creditNoteCount: creditNotes.length,
  };
}

/** GSTN-style GSTR-3B JSON (key sections: 3.1(a) outward, 4 ITC, net payable). */
/** A write-off / expiry-destruction stock movement fed to the GSTR-3B reversal. */
export interface WriteoffRow {
  itemName: string;
  batchNo: string;
  date: string; // 'YYYY-MM-DD'
  qty: number; // positive units written off
  ptrPaise: number; // unit cost (GST-exclusive)
  gstRate: number;
}

export interface WriteoffReversalRow extends WriteoffRow {
  reverseItcPaise: number;
}

export interface WriteoffReversalView {
  rows: WriteoffReversalRow[];
  totalPaise: number;
}

/**
 * ITC to reverse for the period's write-offs / expiry destructions (GSTR-3B Table 4B,
 * Section 17(5)(h)). Per-unit ITC = PTR × the item's GST rate — the same figure
 * `lib/destruction.ts` recorded at destruction time. Paise.
 */
export function buildWriteoffReversal(rows: WriteoffRow[]): WriteoffReversalView {
  const out: WriteoffReversalRow[] = [];
  let total = 0;
  for (const r of rows) {
    const reverseItcPaise = Math.round((r.qty * r.ptrPaise * r.gstRate) / 100);
    out.push({ ...r, reverseItcPaise });
    total += reverseItcPaise;
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows: out, totalPaise: total };
}

export function buildGstr3bJson(summary: Gstr3bSummary, gstin: string) {
  const r = (p: number) => Math.round(p) / 100;
  // Apportion the reversal total across heads by the gross-ITC proportion (Table 4B).
  const rev = (head: number) => (summary.itcTotalPaise > 0 ? Math.round((summary.reversalPaise * head) / summary.itcTotalPaise) : 0);
  return {
    gstin,
    ret_period: gstnPeriod(summary.period),
    sup_details: {
      // 3.1(a) outward taxable supplies — reported NET of sales-return credit notes.
      osup_det: {
        txval: r(summary.outwardTaxablePaise - summary.creditNoteTaxablePaise),
        camt: r(summary.netOutput.cgstPaise),
        samt: r(summary.netOutput.sgstPaise),
        iamt: r(summary.netOutput.igstPaise),
      },
    },
    itc_elg: {
      itc_avl: [{ ty: "OTH", camt: r(summary.itc.cgstPaise), samt: r(summary.itc.sgstPaise), iamt: r(summary.itc.igstPaise) }],
      itc_rev: [{ ty: "OTH", camt: r(rev(summary.itc.cgstPaise)), samt: r(rev(summary.itc.sgstPaise)), iamt: r(rev(summary.itc.igstPaise)) }],
    },
    net_payable: {
      camt: r(Math.max(0, summary.balance.cgstPaise)),
      samt: r(Math.max(0, summary.balance.sgstPaise)),
      iamt: r(Math.max(0, summary.balance.igstPaise)),
      total: r(summary.netPayablePaise),
    },
  };
}

/** Flat CSV of the GSTR-3B summary (spreadsheet fallback). */
export function gstr3bToCsv(summary: Gstr3bSummary): string {
  const m = (p: number) => (Math.round(p) / 100).toFixed(2);
  const rows: (string | number)[][] = [
    ["row", "cgst", "sgst", "igst", "total"],
    ["Output tax (sales)", m(summary.output.cgstPaise), m(summary.output.sgstPaise), m(summary.output.igstPaise), m(summary.outputTotalPaise)],
    ["Less: credit notes (sales returns)", m(summary.creditNote.cgstPaise), m(summary.creditNote.sgstPaise), m(summary.creditNote.igstPaise), m(summary.creditNoteTotalPaise)],
    ["Net output tax", "", "", "", m(summary.netOutputTotalPaise)],
    ["Gross ITC (purchases)", m(summary.itc.cgstPaise), m(summary.itc.sgstPaise), m(summary.itc.igstPaise), m(summary.itcTotalPaise)],
    ["Less: ITC reversal (write-offs)", "", "", "", m(summary.reversalPaise)],
    ["Net ITC (after reversal)", "", "", "", m(summary.netItcPaise)],
    ["Net payable (after set-off)", "", "", "", m(summary.netPayablePaise)],
    ["Outward taxable value", "", "", "", m(summary.outwardTaxablePaise)],
  ];
  return rows.map((cols) => cols.map(csvCell).join(",")).join("\n");
}

// ============================================================================
// GST liability — current-month output/ITC/net + due date + MoM/YoY trend
// ============================================================================

/** A tax-bearing document tagged with its date ('YYYY-MM-DD'); only the heads matter here. */
export interface DatedTaxRow {
  date: string;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

/** Net GST position for one month (all paise). */
export interface MonthLiability {
  period: string; // 'YYYY-MM'
  outputPaise: number; // tax on sales
  itcPaise: number; // tax credit on purchases
  netPaise: number; // output − itc (signed; negative = surplus credit)
  netPayablePaise: number; // max(0, net) — the cash figure
}

/** A MoM / YoY comparison of net payable. `prev` is null when that month had no documents. */
export interface LiabilityDelta {
  prev: MonthLiability | null;
  deltaPaise: number; // current.netPayable − prev.netPayable
  pct: number | null; // null when prev is absent or zero
}

export interface GstLiabilityView {
  current: MonthLiability;
  dueDate: string; // 'YYYY-MM-DD' — 20th of the month after `current`
  mom: LiabilityDelta;
  yoy: LiabilityDelta;
  series: MonthLiability[]; // chronological ascending, one per month in the window
}

/** Shift a 'YYYY-MM' period by a (possibly negative) number of months. */
export function shiftPeriod(period: string, deltaMonths: number): string {
  const [y, m] = period.split("-").map(Number);
  const idx = y * 12 + (m - 1) + deltaMonths;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function sumHeads(r: DatedTaxRow): number {
  return r.cgst_paise + r.sgst_paise + r.igst_paise;
}

function liabilityDelta(current: MonthLiability, prev: MonthLiability | null): LiabilityDelta {
  if (!prev) return { prev: null, deltaPaise: current.netPayablePaise, pct: null };
  const d = current.netPayablePaise - prev.netPayablePaise;
  return { prev, deltaPaise: d, pct: prev.netPayablePaise > 0 ? (d / prev.netPayablePaise) * 100 : null };
}

/**
 * Build the GST liability view ending at `currentPeriod`, over a window of
 * `months` months (the series covers `currentPeriod-(months-1) … currentPeriod`;
 * default 13 so the same month last year is in-window for YoY). Output tax comes
 * from sales rows, ITC from purchase rows — both bucketed by month from their
 * date. Net payable = `max(0, output − itc)`. GSTR-3B for month M is due the 20th
 * of M+1. All money is paise.
 */
export function buildGstLiability(
  currentPeriod: string,
  sales: DatedTaxRow[],
  purchases: DatedTaxRow[],
  months = 13,
): GstLiabilityView {
  const output = new Map<string, number>();
  const itc = new Map<string, number>();
  for (const r of sales) {
    const k = r.date.slice(0, 7);
    output.set(k, (output.get(k) ?? 0) + sumHeads(r));
  }
  for (const r of purchases) {
    const k = r.date.slice(0, 7);
    itc.set(k, (itc.get(k) ?? 0) + sumHeads(r));
  }

  const monthOf = (period: string): MonthLiability => {
    const o = output.get(period) ?? 0;
    const i = itc.get(period) ?? 0;
    const net = o - i;
    return { period, outputPaise: o, itcPaise: i, netPaise: net, netPayablePaise: Math.max(0, net) };
  };
  const monthOrNull = (period: string): MonthLiability | null =>
    output.has(period) || itc.has(period) ? monthOf(period) : null;

  const series: MonthLiability[] = [];
  for (let k = months - 1; k >= 0; k--) series.push(monthOf(shiftPeriod(currentPeriod, -k)));

  const current = monthOf(currentPeriod);
  return {
    current,
    dueDate: `${shiftPeriod(currentPeriod, 1)}-20`,
    mom: liabilityDelta(current, monthOrNull(shiftPeriod(currentPeriod, -1))),
    yoy: liabilityDelta(current, monthOrNull(shiftPeriod(currentPeriod, -12))),
    series,
  };
}

// ============================================================================
// ITC register + reversal pre-calc (SALT-064)
// ============================================================================

/** One inward invoice in the ITC register (a `purchases` row + its vendor). */
export interface ItcInvoiceRow {
  invoiceNo: string;
  date: string; // received_date 'YYYY-MM-DD'
  vendorName: string;
  vendorGstin: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface ItcRegisterTotals {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  itcPaise: number; // cgst + sgst + igst
}

export interface ItcRegisterView {
  rows: ItcInvoiceRow[];
  totals: ItcRegisterTotals;
  count: number;
}

/** Aggregate a period's inward invoices into the ITC register (rows sorted by date). */
export function buildItcRegister(rows: ItcInvoiceRow[]): ItcRegisterView {
  const totals: ItcRegisterTotals = { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, itcPaise: 0 };
  for (const r of rows) {
    totals.taxablePaise += r.taxablePaise;
    totals.cgstPaise += r.cgstPaise;
    totals.sgstPaise += r.sgstPaise;
    totals.igstPaise += r.igstPaise;
  }
  totals.itcPaise = totals.cgstPaise + totals.sgstPaise + totals.igstPaise;
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows: sorted, totals, count: rows.length };
}

/** A batch fed to the reversal pre-calc; `expiry` is 'YYYY-MM' (or empty). */
export interface ExpiredBatchInput {
  itemName: string;
  batchNo: string;
  expiry: string;
  qty: number;
  ptrPaise: number; // GST-exclusive purchase rate per unit
  gstRate: number;
}

export interface ItcReversalRow extends ExpiredBatchInput {
  reverseItcPaise: number;
}

export interface ItcReversalView {
  rows: ItcReversalRow[];
  totalReversePaise: number;
}

/**
 * ITC to reverse on expired stock (Section 17(5)(h)). A batch counts when it still
 * has stock (`qty > 0`) and its `expiry` month (YYYY-MM, lexical compare) is before
 * `currentPeriod`. Per-unit ITC is estimated from PTR × the item's GST rate
 * (advisory — the exact figure would come from the batch's purchase line). Paise.
 */
export function buildItcReversal(batches: ExpiredBatchInput[], currentPeriod: string): ItcReversalView {
  const rows: ItcReversalRow[] = [];
  let total = 0;
  for (const b of batches) {
    if (b.qty <= 0 || !b.expiry || b.expiry >= currentPeriod) continue;
    const reverseItcPaise = Math.round((b.qty * b.ptrPaise * b.gstRate) / 100);
    rows.push({ ...b, reverseItcPaise });
    total += reverseItcPaise;
  }
  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  return { rows, totalReversePaise: total };
}

/** Flat CSV of the ITC register (spreadsheet fallback). */
export function itcRegisterToCsv(view: ItcRegisterView): string {
  const m = (p: number) => (Math.round(p) / 100).toFixed(2);
  const head = ["vendor", "gstin", "invoice", "date", "taxable", "cgst", "sgst", "igst", "itc"];
  const rows = view.rows.map((r) => [
    r.vendorName,
    r.vendorGstin,
    r.invoiceNo,
    r.date,
    m(r.taxablePaise),
    m(r.cgstPaise),
    m(r.sgstPaise),
    m(r.igstPaise),
    m(r.cgstPaise + r.sgstPaise + r.igstPaise),
  ]);
  const totalRow = ["TOTAL", "", "", "", m(view.totals.taxablePaise), m(view.totals.cgstPaise), m(view.totals.sgstPaise), m(view.totals.igstPaise), m(view.totals.itcPaise)];
  return [head, ...rows, totalRow].map((c) => c.map(csvCell).join(",")).join("\n");
}

// ============================================================================
// Tally XML export (SALT-070) — sales + purchase vouchers for the accountant
// ============================================================================

/** A sale as a Tally voucher input (`partyName` is "Cash" for walk-in / cash bills). */
export interface TallySaleRow {
  invoiceNo: string;
  date: string; // 'YYYY-MM-DD'
  partyName: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** A purchase as a Tally voucher input. */
export interface TallyPurchaseRow {
  invoiceNo: string;
  date: string;
  vendorName: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

const TALLY = {
  sales: "Sales",
  purchase: "Purchase",
  outCgst: "Output CGST",
  outSgst: "Output SGST",
  outIgst: "Output IGST",
  inCgst: "Input CGST",
  inSgst: "Input SGST",
  inIgst: "Input IGST",
} as const;

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/** paise → rupee string, 2 dp (Tally amounts are rupees). */
function rupeeStr(paise: number): string {
  return (Math.round(paise) / 100).toFixed(2);
}

/**
 * One Tally ledger line. In Tally XML, AMOUNT is **negative for a debit** and
 * positive for a credit, with ISDEEMEDPOSITIVE 'Yes' on debits. Zero is omitted.
 */
function ledgerEntry(name: string, debit: boolean, paise: number): string {
  if (paise === 0) return "";
  const amt = debit ? -Math.round(paise) : Math.round(paise);
  return [
    "        <ALLLEDGERENTRIES.LIST>",
    `          <LEDGERNAME>${xmlEscape(name)}</LEDGERNAME>`,
    `          <ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
    `          <AMOUNT>${rupeeStr(amt)}</AMOUNT>`,
    "        </ALLLEDGERENTRIES.LIST>",
  ].join("\n");
}

function voucher(vchType: string, date: string, num: string, partyName: string, entries: string[]): string {
  return [
    "      <TALLYMESSAGE>",
    `        <VOUCHER VCHTYPE="${xmlEscape(vchType)}" ACTION="Create">`,
    `          <DATE>${date.replace(/-/g, "")}</DATE>`,
    `          <VOUCHERTYPENAME>${xmlEscape(vchType)}</VOUCHERTYPENAME>`,
    `          <VOUCHERNUMBER>${xmlEscape(num)}</VOUCHERNUMBER>`,
    `          <PARTYLEDGERNAME>${xmlEscape(partyName)}</PARTYLEDGERNAME>`,
    ...entries.filter(Boolean),
    "        </VOUCHER>",
    "      </TALLYMESSAGE>",
  ].join("\n");
}

/**
 * Build a Tally-importable XML envelope of the period's sales + purchase vouchers,
 * each a balanced double entry carrying the GST split:
 *  - Sale:     Dr party/Cash (total) · Cr Sales (taxable) · Cr Output CGST/SGST/IGST
 *  - Purchase: Dr Purchase (taxable) · Dr Input CGST/SGST/IGST · Cr vendor (total)
 * Ledgers are referenced by name (Tally maps/creates them on import). Amounts in rupees.
 */
export function buildTallyXml(companyName: string, sales: TallySaleRow[], purchases: TallyPurchaseRow[]): string {
  const vouchers: string[] = [];
  for (const s of sales) {
    vouchers.push(
      voucher("Sales", s.date, s.invoiceNo, s.partyName, [
        ledgerEntry(s.partyName, true, s.totalPaise),
        ledgerEntry(TALLY.sales, false, s.taxablePaise),
        ledgerEntry(TALLY.outCgst, false, s.cgstPaise),
        ledgerEntry(TALLY.outSgst, false, s.sgstPaise),
        ledgerEntry(TALLY.outIgst, false, s.igstPaise),
      ]),
    );
  }
  for (const p of purchases) {
    vouchers.push(
      voucher("Purchase", p.date, p.invoiceNo, p.vendorName, [
        ledgerEntry(TALLY.purchase, true, p.taxablePaise),
        ledgerEntry(TALLY.inCgst, true, p.cgstPaise),
        ledgerEntry(TALLY.inSgst, true, p.sgstPaise),
        ledgerEntry(TALLY.inIgst, true, p.igstPaise),
        ledgerEntry(p.vendorName, false, p.totalPaise),
      ]),
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>Vouchers</REPORTNAME>",
    `        <STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`,
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    ...vouchers,
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>",
  ].join("\n");
}

// ============================================================================
// HSN-wise summary report (SALT-068) — flexible date range (e.g. GSTR-9 annual)
// ============================================================================

/** A sale line for the HSN summary (date-filtered upstream by its invoice). */
export interface HsnLineInput {
  hsn: string | null;
  gst_rate: number;
  qty: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

export interface HsnSummary {
  rows: HsnRow[];
  totals: TaxTotals;
  qty: number;
}

/** Aggregate sale lines by HSN × rate (the GSTR-1 §12 / GSTR-9 HSN table, over any range). */
export function buildHsnSummary(lines: HsnLineInput[]): HsnSummary {
  const map = new Map<string, HsnRow>();
  const totals = emptyTotals();
  let qty = 0;
  for (const line of lines) {
    const hsn = line.hsn?.trim() || "—";
    const key = `${hsn}|${line.gst_rate}`;
    let row = map.get(key);
    if (!row) {
      row = { hsn, rate: line.gst_rate, qty: 0, ...emptyTotals() };
      map.set(key, row);
    }
    row.qty += line.qty;
    addInto(row, line);
    qty += line.qty;
    addInto(totals, line);
  }
  return { rows: sortRows(Array.from(map.values()), (r) => [r.hsn, r.rate]), totals, qty };
}

/** Flat CSV of the HSN summary (spreadsheet fallback). */
export function hsnSummaryToCsv(s: HsnSummary): string {
  const m = (p: number) => (Math.round(p) / 100).toFixed(2);
  const head = ["hsn", "rate", "qty", "taxable", "cgst", "sgst", "igst", "total"];
  const rows = s.rows.map((r) => [r.hsn, r.rate, r.qty, m(r.taxablePaise), m(r.cgstPaise), m(r.sgstPaise), m(r.igstPaise), m(r.totalPaise)]);
  const total = ["TOTAL", "", s.qty, m(s.totals.taxablePaise), m(s.totals.cgstPaise), m(s.totals.sgstPaise), m(s.totals.igstPaise), m(s.totals.totalPaise)];
  return [head, ...rows, total].map((c) => c.map(csvCell).join(",")).join("\n");
}

// ============================================================================
// GSTR-1 credit notes — CDNR (registered) / CDNUR (B2C) (SALT-196)
// ============================================================================

/** One rate slice of a credit note (from `credit_note_lines`, merged per `gst_rate`). */
export interface Gstr1CreditNoteLine {
  rate: number; // gst_rate, e.g. 5 / 12 / 18
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

/** A sales-return `credit_notes` row: party + original invoice embedded, with rate-wise lines. */
export interface Gstr1CreditNoteRow {
  noteNo: string;
  date: string; // note_date 'YYYY-MM-DD'
  is_interstate: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  origInvoiceNo: string | null; // sale_invoice_id → sales_invoices.invoice_no
  origInvoiceDate: string | null; // → sales_invoices.invoice_date
  lines: Gstr1CreditNoteLine[]; // credit_note_lines, rate-wise
  party: { gstin: string | null; name: string | null; state_code: string | null } | null;
}

/** A rate-wise CDNR row (recipient registered) — one per note × rate. */
export interface CdnrRow extends TaxTotals {
  gstin: string;
  name: string;
  noteNo: string;
  date: string;
  origInvoiceNo: string;
  origInvoiceDate: string;
  pos: string;
  rate: number;
}
/** A rate-wise CDNUR row (recipient unregistered / B2C) — one per note × rate. */
export interface CdnurRow extends TaxTotals {
  noteNo: string;
  date: string;
  origInvoiceNo: string;
  origInvoiceDate: string;
  pos: string;
  supplyType: "INTRA" | "INTER";
  rate: number;
}
export interface CreditNoteSections {
  cdnr: CdnrRow[]; // registered recipients, rate-wise
  cdnur: CdnurRow[]; // unregistered / B2C, rate-wise
  totals: TaxTotals; // all credit notes (the outward-tax reversal)
}

/**
 * Split a period's sales-return credit notes into GSTR-1 **CDNR** (recipient has a
 * GSTIN) and **CDNUR** (B2C), **rate-wise** (one row per note × `gst_rate`), each
 * carrying the original invoice ref. Place of supply = recipient's state, else the
 * shop's. The grand total is the outward-tax reversal that GSTR-3B 3.1(a) nets out.
 */
export function buildCreditNoteSections(creditNotes: Gstr1CreditNoteRow[], shopStateCode: string): CreditNoteSections {
  const cdnr: CdnrRow[] = [];
  const cdnur: CdnurRow[] = [];
  const totals = emptyTotals();
  for (const cn of creditNotes) {
    const gstin = cn.party?.gstin?.trim() ?? "";
    const pos = cn.party?.state_code?.trim() || shopStateCode;
    const name = cn.party?.name?.trim() || "";
    const origInvoiceNo = cn.origInvoiceNo ?? "";
    const origInvoiceDate = cn.origInvoiceDate ?? "";
    // Rate-wise lines; fall back to a single note-level slice if none were supplied.
    const raw: Gstr1CreditNoteLine[] = cn.lines.length
      ? cn.lines
      : [{ rate: 0, taxable_paise: cn.taxable_paise, cgst_paise: cn.cgst_paise, sgst_paise: cn.sgst_paise, igst_paise: cn.igst_paise }];
    // Merge lines that share a rate → one CDNR/CDNUR item per rate.
    const byRate = new Map<number, Gstr1CreditNoteLine>();
    for (const ln of raw) {
      const cur = byRate.get(ln.rate);
      if (cur) {
        cur.taxable_paise += ln.taxable_paise;
        cur.cgst_paise += ln.cgst_paise;
        cur.sgst_paise += ln.sgst_paise;
        cur.igst_paise += ln.igst_paise;
      } else {
        byRate.set(ln.rate, { ...ln });
      }
    }
    for (const ln of byRate.values()) {
      addInto(totals, ln);
      if (gstin) {
        const row: CdnrRow = { gstin, name, noteNo: cn.noteNo, date: cn.date, origInvoiceNo, origInvoiceDate, pos, rate: ln.rate, ...emptyTotals() };
        addInto(row, ln);
        cdnr.push(row);
      } else {
        const row: CdnurRow = { noteNo: cn.noteNo, date: cn.date, origInvoiceNo, origInvoiceDate, pos, supplyType: cn.is_interstate ? "INTER" : "INTRA", rate: ln.rate, ...emptyTotals() };
        addInto(row, ln);
        cdnur.push(row);
      }
    }
  }
  cdnr.sort((a, b) => a.gstin.localeCompare(b.gstin) || a.noteNo.localeCompare(b.noteNo) || a.rate - b.rate);
  cdnur.sort((a, b) => a.noteNo.localeCompare(b.noteNo) || a.rate - b.rate);
  return { cdnr, cdnur, totals };
}

/** GSTN-shaped `{ cdnr, cdnur }` for the GSTR-1 JSON — note type 'C', rate-wise `itms`. */
export function creditNoteSectionsToJson(s: CreditNoteSections) {
  const r = (p: number) => Math.round(p) / 100;
  const itm = (x: CdnrRow | CdnurRow, i: number) => ({ num: i + 1, itm_det: { rt: x.rate, txval: r(x.taxablePaise), camt: r(x.cgstPaise), samt: r(x.sgstPaise), iamt: r(x.igstPaise) } });
  const val = (rows: TaxTotals[]) => r(rows.reduce((a, x) => a + x.totalPaise, 0));
  const origRef = (onum: string, odt: string) => ({ ...(onum ? { onum } : {}), ...(odt ? { odt: gstnDate(odt) } : {}) });

  // CDNR: group ctin → note → rate-wise itms.
  const ctinMap = new Map<string, Map<string, CdnrRow[]>>();
  for (const x of s.cdnr) {
    let notes = ctinMap.get(x.gstin);
    if (!notes) ctinMap.set(x.gstin, (notes = new Map()));
    const list = notes.get(x.noteNo);
    if (list) list.push(x);
    else notes.set(x.noteNo, [x]);
  }
  const cdnr = Array.from(ctinMap, ([ctin, notes]) => ({
    ctin,
    nt: Array.from(notes, ([nt_num, rows]) => ({
      ntty: "C",
      nt_num,
      nt_dt: gstnDate(rows[0].date),
      ...origRef(rows[0].origInvoiceNo, rows[0].origInvoiceDate),
      rchrg: "N",
      inv_typ: "R",
      pos: rows[0].pos,
      val: val(rows),
      itms: rows.map(itm),
    })),
  }));

  // CDNUR: group note → rate-wise itms.
  const cnurMap = new Map<string, CdnurRow[]>();
  for (const x of s.cdnur) {
    const list = cnurMap.get(x.noteNo);
    if (list) list.push(x);
    else cnurMap.set(x.noteNo, [x]);
  }
  const cdnur = Array.from(cnurMap, ([nt_num, rows]) => ({
    typ: rows[0].supplyType === "INTER" ? "B2CL" : "B2CS",
    ntty: "C",
    nt_num,
    nt_dt: gstnDate(rows[0].date),
    ...origRef(rows[0].origInvoiceNo, rows[0].origInvoiceDate),
    pos: rows[0].pos,
    val: val(rows),
    itms: rows.map(itm),
  }));

  return { cdnr, cdnur };
}

/** Flat rate-wise CSV of the credit-note sections (spreadsheet fallback). */
export function creditNotesToCsv(s: CreditNoteSections): string {
  const m = (p: number) => (Math.round(p) / 100).toFixed(2);
  const head = ["section", "gstin", "note", "date", "orig invoice", "orig date", "pos", "rate", "taxable", "cgst", "sgst", "igst", "total"];
  const rows: (string | number)[][] = [];
  for (const x of s.cdnr) rows.push(["CDNR", x.gstin, x.noteNo, x.date, x.origInvoiceNo || "—", x.origInvoiceDate || "—", x.pos, x.rate, m(x.taxablePaise), m(x.cgstPaise), m(x.sgstPaise), m(x.igstPaise), m(x.totalPaise)]);
  for (const x of s.cdnur) rows.push(["CDNUR", "", x.noteNo, x.date, x.origInvoiceNo || "—", x.origInvoiceDate || "—", x.pos, x.rate, m(x.taxablePaise), m(x.cgstPaise), m(x.sgstPaise), m(x.igstPaise), m(x.totalPaise)]);
  return [head, ...rows].map((c) => c.map(csvCell).join(",")).join("\n");
}
