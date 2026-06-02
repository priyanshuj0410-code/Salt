import type { DiscountType } from "./types";
import type { RowIssue } from "./import";

/**
 * Purchase-invoice import (SALT-125) — parse a one-row-per-line vendor-bill CSV,
 * group it into invoices, and validate. This is the POSTING importer: unlike the
 * Smart Import purchase *register* (non-posting history), each parsed invoice is
 * committed through the `receive_purchase` RPC, so it adds stock + vendor payable +
 * ITC exactly like a hand-entered GRN. Vendors and items that don't exist yet are
 * auto-created at commit time (see the unified import page, OcrInvoiceImportPage).
 *
 * Pure + type-only imports, so it stays unit-testable; money totals are computed in
 * the page via grnTotals from lib/grn.
 */

export interface ParsedPurchaseLine {
  /** Vendor's item code, if any — used to match/auto-create the item (items.item_code). */
  itemCode: string;
  name: string;
  batchNo: string;
  expiry: string; // YYYY-MM or ""
  qty: number;
  freeQty: number;
  /** The billed/landed cost per unit (what computeGrnLine uses). */
  ptrPaise: number;
  /** Printed PTR in paise (storage); equals the cost unless billed on PTS. */
  printedPtrPaise: number;
  /** Printed PTS in paise, or null when not printed. */
  ptsPaise: number | null;
  /** Which printed column the cost uses. */
  costBasis: "ptr" | "pts";
  mrpPaise: number;
  gstRate: number;
  discountType: DiscountType | null;
  discountValue: number;
  schemeText: string;
  hsn: string;
  barcode: string;
}

export interface ParsedPurchaseInvoice {
  /** Group key: invoice no + vendor (lower-cased). */
  key: string;
  invoiceNo: string;
  date: string | null; // YYYY-MM-DD
  vendorName: string;
  vendorGstin: string;
  lines: ParsedPurchaseLine[];
  /** True when none of this invoice's rows raised an error. */
  valid: boolean;
}

export interface PurchaseImportResult {
  invoices: ParsedPurchaseInvoice[];
  issues: RowIssue[];
  lineCount: number;
  errorCount: number;
  warningCount: number;
  /** Distinct vendor names across all invoices (for the "will create N vendors" note). */
  vendorNames: string[];
}

export type PurchaseRawRow = Record<string, string | undefined>;

export const PURCHASE_IMPORT_COLUMNS = [
  "invoice_no",
  "date",
  "vendor",
  "vendor_gstin",
  "item_code",
  "item_name",
  "batch_no",
  "expiry",
  "qty",
  "free_qty",
  "ptr",
  "pts",
  "amount",
  "mrp",
  "gst_rate",
  "discount_pct",
] as const;

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const RAW_ALIASES: Record<string, string> = {
  invoiceno: "invoice_no", billno: "invoice_no", grnno: "invoice_no", voucherno: "invoice_no",
  vendorinvoice: "invoice_no", refno: "invoice_no", bill: "invoice_no", invoice: "invoice_no",
  billdate: "date", invoicedate: "date", grndate: "date", purchasedate: "date",
  vendor: "vendor", supplier: "vendor", party: "vendor", partyname: "vendor", account: "vendor", seller: "vendor",
  gstin: "vendor_gstin", gstno: "vendor_gstin", gstnumber: "vendor_gstin", vendorgstin: "vendor_gstin", partygstin: "vendor_gstin",
  itemcode: "item_code", code: "item_code", sku: "item_code", productcode: "item_code",
  item: "item_name", product: "item_name", itemname: "item_name", productname: "item_name", description: "item_name", particulars: "item_name", medicine: "item_name",
  batch: "batch_no", batchno: "batch_no", lot: "batch_no", lotno: "batch_no",
  exp: "expiry", expdate: "expiry", expirydate: "expiry", expdt: "expiry",
  quantity: "qty", pcs: "qty", received: "qty",
  free: "free_qty", freeqty: "free_qty", schemeqty: "free_qty", fqty: "free_qty",
  purchaserate: "ptr", cost: "ptr", costprice: "ptr", prate: "ptr", purchaseprice: "ptr", rate: "ptr", ptrrate: "ptr",
  pricetostockist: "pts", ptsrate: "pts", stockistrate: "pts", stockistprice: "pts",
  value: "amount", netvalue: "amount", netamount: "amount", taxablevalue: "amount", taxableamount: "amount", linevalue: "amount",
  maxretailprice: "mrp", mrprate: "mrp",
  gst: "gst_rate", gstrate: "gst_rate", igst: "gst_rate", tax: "gst_rate", taxrate: "gst_rate",
  discount: "discount_pct", disc: "discount_pct", discpct: "discount_pct", tradediscount: "discount_pct", schemepct: "discount_pct",
};

const HEADER_ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of PURCHASE_IMPORT_COLUMNS) m[norm(c)] = c;
  for (const [k, v] of Object.entries(RAW_ALIASES)) m[k] = v;
  return m;
})();

export function canonicalPurchaseHeader(raw: string): string {
  const n = norm(raw);
  return HEADER_ALIASES[n] ?? n;
}

const s = (v: string | undefined) => (v ?? "").trim();
function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Accept DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD → ISO YYYY-MM-DD, else null. */
export function parseInvoiceDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Which column a line's purchase rate was taken from. */
export type PriceSource = "ptr" | "pts" | "amount";

export interface ResolvedRate {
  /** Chosen per-unit purchase rate — the billed/landed COST, in paise. */
  ratePaise: number;
  /** Printed PTR in paise (or the cost when no PTR was printed) — stored for the record. */
  printedPtrPaise: number;
  /** Printed PTS in paise, or null when not printed — stored for the record. */
  ptsPaise: number | null;
  /** Which printed column the landed cost uses ('amount'-derived ⇒ 'ptr'). */
  costBasis: "ptr" | "pts";
  source: PriceSource;
  /** True when both PTR & PTS were printed but no amount could disambiguate (defaulted to PTR). */
  ambiguous: boolean;
}

/**
 * Pick the per-unit rate an invoice actually billed each line on. Pharma invoices
 * often print BOTH PTR (price to retailer) and PTS (price to stockist), but the line
 * value is computed from only one of them — so trusting PTR blindly is wrong on a
 * PTS-billed bill. When the printed net `amount` (post scheme/discount, pre-GST) is
 * present, choose whichever rate's `qty·rate·(1−disc)` matches it (within 5%); if
 * neither matches, derive the rate from the amount itself (faithful to the bill).
 * With no amount to reconcile, default to PTR (retailer norm), else PTS. Pure → tested.
 */
export function resolvePurchaseRate(args: {
  qty: number;
  ptr: number;
  pts: number;
  amount: number;
  discountPct: number;
}): ResolvedRate {
  const { qty, ptr, pts, amount } = args;
  const factor = 1 - (args.discountPct > 0 ? args.discountPct : 0) / 100; // discount off the gross
  const toPaise = (r: number) => Math.round(r * 100);

  // 1. Resolve the billed COST + which column it came from.
  const core: { ratePaise: number; source: PriceSource; ambiguous: boolean } = (() => {
    const candidates: { rate: number; source: PriceSource }[] = [];
    if (ptr > 0) candidates.push({ rate: ptr, source: "ptr" });
    if (pts > 0) candidates.push({ rate: pts, source: "pts" });
    if (amount > 0 && qty > 0 && factor > 0) {
      let best: { rate: number; source: PriceSource } | null = null;
      let bestErr = Infinity;
      for (const c of candidates) {
        const err = Math.abs(c.rate * qty * factor - amount) / amount;
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
      if (best && bestErr <= 0.05) return { ratePaise: toPaise(best.rate), source: best.source, ambiguous: false };
      // Neither labelled rate matches the printed amount → trust the bill: derive from it.
      return { ratePaise: toPaise(amount / (qty * factor)), source: "amount", ambiguous: false };
    }
    if (ptr > 0) return { ratePaise: toPaise(ptr), source: "ptr", ambiguous: pts > 0 };
    if (pts > 0) return { ratePaise: toPaise(pts), source: "pts", ambiguous: false };
    if (amount > 0 && qty > 0 && factor > 0) return { ratePaise: toPaise(amount / (qty * factor)), source: "amount", ambiguous: false };
    return { ratePaise: 0, source: "ptr", ambiguous: false };
  })();

  // 2. Keep both printed rates. Invariant for the server: the recovered cost
  //    (costBasis === 'pts' ? ptsPaise : printedPtrPaise) equals ratePaise — so on a
  //    'ptr'/'amount' basis, printedPtrPaise IS the cost.
  const costBasis: "ptr" | "pts" = core.source === "pts" ? "pts" : "ptr";
  const ptsPaise = pts > 0 ? toPaise(pts) : costBasis === "pts" ? core.ratePaise : null;
  const printedPtrPaise = costBasis === "ptr" ? core.ratePaise : ptr > 0 ? toPaise(ptr) : core.ratePaise;
  return { ratePaise: core.ratePaise, printedPtrPaise, ptsPaise, costBasis, source: core.source, ambiguous: core.ambiguous };
}

export function parsePurchaseInvoices(rows: PurchaseRawRow[]): PurchaseImportResult {
  const groups = new Map<string, ParsedPurchaseInvoice>();
  const issues: RowIssue[] = [];
  const errorRows = new Set<string>(); // invoice keys with at least one error row
  let lineCount = 0;

  rows.forEach((raw, i) => {
    const line = i + 2; // +1 header, +1 to 1-base
    const invoiceNo = s(raw.invoice_no);
    const vendorName = s(raw.vendor);
    const name = s(raw.item_name);

    if (!invoiceNo) {
      issues.push({ row: line, level: "error", message: "Missing invoice/bill no — row skipped" });
      return;
    }
    if (!vendorName) {
      issues.push({ row: line, level: "error", message: `Invoice ${invoiceNo}: missing vendor — row skipped` });
      return;
    }
    const key = `${invoiceNo.toLowerCase()}|${vendorName.toLowerCase()}`;

    if (!name) {
      issues.push({ row: line, level: "error", message: `Invoice ${invoiceNo}: missing item name` });
      errorRows.add(key);
      return;
    }
    const qty = num(raw.qty);
    if (qty == null || qty <= 0 || !Number.isInteger(qty)) {
      issues.push({ row: line, level: "error", message: `"${name}": quantity must be a whole number > 0` });
      errorRows.add(key);
      return;
    }
    const discountValue = num(raw.discount_pct) ?? 0;
    // The invoice may print PTR and/or PTS; pick the rate the bill actually charged on
    // by reconciling against the printed line amount (auto-detect). Falls back to PTR.
    const resolved = resolvePurchaseRate({
      qty,
      ptr: num(raw.ptr) ?? 0,
      pts: num(raw.pts) ?? 0,
      amount: num(raw.amount) ?? 0,
      discountPct: discountValue,
    });
    if (resolved.ratePaise <= 0) {
      issues.push({ row: line, level: "error", message: `"${name}": no usable purchase rate — set PTR, PTS or the line amount` });
      errorRows.add(key);
      return;
    }
    const rate = resolved.ratePaise / 100;
    if (resolved.source === "pts") {
      issues.push({ row: line, level: "warning", message: `"${name}": billed on PTS ₹${rate.toFixed(2)}/unit (matches the invoice amount), not PTR` });
    } else if (resolved.source === "amount") {
      issues.push({ row: line, level: "warning", message: `"${name}": rate ₹${rate.toFixed(2)}/unit derived from the printed amount — verify` });
    } else if (resolved.ambiguous) {
      issues.push({ row: line, level: "warning", message: `"${name}": invoice shows PTR & PTS but no line amount — used PTR; confirm it should not be PTS` });
    }
    const mrp = num(raw.mrp) ?? 0;
    if (mrp <= 0) {
      issues.push({ row: line, level: "warning", message: `"${name}": no MRP — the received batch will not be sellable until you set one` });
    } else if (mrp < rate) {
      issues.push({ row: line, level: "warning", message: `"${name}": MRP is below purchase rate` });
    }

    const free = num(raw.free_qty) ?? 0;
    const gstRate = num(raw.gst_rate) ?? 0;
    const expiry = s(raw.expiry);
    if (expiry && !/^\d{4}-\d{2}$/.test(expiry)) {
      issues.push({ row: line, level: "warning", message: `"${name}": expiry "${expiry}" is not YYYY-MM` });
    }

    let inv = groups.get(key);
    if (!inv) {
      inv = {
        key,
        invoiceNo,
        date: parseInvoiceDate(s(raw.date)),
        vendorName,
        vendorGstin: s(raw.vendor_gstin).toUpperCase(),
        lines: [],
        valid: true,
      };
      groups.set(key, inv);
    } else if (!inv.vendorGstin && raw.vendor_gstin) {
      inv.vendorGstin = s(raw.vendor_gstin).toUpperCase();
    }

    inv.lines.push({
      itemCode: s(raw.item_code),
      name,
      batchNo: s(raw.batch_no),
      expiry,
      qty,
      freeQty: free < 0 ? 0 : free,
      ptrPaise: resolved.ratePaise,
      printedPtrPaise: resolved.printedPtrPaise,
      ptsPaise: resolved.ptsPaise,
      costBasis: resolved.costBasis,
      mrpPaise: Math.round(mrp * 100),
      gstRate,
      discountType: discountValue > 0 ? "pct" : null,
      discountValue,
      schemeText: "",
      hsn: s(raw.hsn),
      barcode: s(raw.barcode),
    });
    lineCount++;
  });

  const invoices = [...groups.values()].map((inv) => ({ ...inv, valid: !errorRows.has(inv.key) }));
  const vendorNames = [...new Set(invoices.map((inv) => inv.vendorName))];
  return {
    invoices,
    issues,
    lineCount,
    errorCount: issues.filter((p) => p.level === "error").length,
    warningCount: issues.filter((p) => p.level === "warning").length,
    vendorNames,
  };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function purchaseTemplateCsv(): string {
  const rows: string[][] = [
    [...PURCHASE_IMPORT_COLUMNS],
    ["INV-001", "2026-05-28", "Cipla Distributors", "27AAPFU0939F1ZV", "CIP100", "Dolo 650", "DL2411", "2027-03", "100", "10", "25.20", "22.00", "2520.00", "31.50", "12", "0"],
    ["INV-001", "2026-05-28", "Cipla Distributors", "27AAPFU0939F1ZV", "CIP205", "Augmentin 625 Duo", "AG2501", "2026-08", "50", "0", "187.70", "165.00", "9197.30", "223.40", "12", "2"],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
