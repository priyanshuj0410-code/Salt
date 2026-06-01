import { recomputeReturn, returnableQty, type ReturnBasis } from "./returns";

// SALT-189 — adopt the shared returns engine (lib/returns.ts, SALT-099) in the
// sales-return / credit-note path. A sale line's persisted `taxable_paise` is the
// net AFTER line + apportioned bill-level discount (create_sales_invoice backs it
// out of the discounted line total), so it is exactly the engine's ReturnBasis
// taxable — a partial return reverses the discounted net + its outward GST, never
// the gross. Pure module (no Supabase) so it stays smoke-testable.

/** A sale line as persisted, reduced to what a return needs. */
export interface SaleLineForReturn {
  id: string;
  item_id: string | null;
  batch_id: string | null;
  name: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  rate_paise: number;
  gst_rate: number;
  taxable_paise: number;
  line_total_paise: number;
}

/** A line in the return editor: the original sale line + how many already returned + the qty entered now. */
export interface ReturnEditorLine {
  saleLineId: string;
  itemId: string | null;
  batchId: string | null;
  name: string;
  batchNo: string | null;
  expiry: string | null;
  gstRate: number;
  /** Units sold on the original line. */
  soldQty: number;
  /** Units already returned in prior placed credit notes. */
  alreadyReturned: number;
  /** Units still returnable = sold − alreadyReturned. */
  returnable: number;
  /** Net taxable for the whole line (post-discount), the engine basis. */
  taxablePaise: number;
  /** Qty the operator wants to return now (UI state). */
  returnQty: number;
}

/** Build the editor lines from sale lines + a map of already-returned qty per sale_line_id. */
export function buildReturnEditorLines(
  saleLines: SaleLineForReturn[],
  alreadyReturnedBySaleLine: Map<string, number>,
): ReturnEditorLine[] {
  return saleLines.map((l) => {
    const alreadyReturned = alreadyReturnedBySaleLine.get(l.id) ?? 0;
    const basis = basisOf(l, alreadyReturned);
    return {
      saleLineId: l.id,
      itemId: l.item_id,
      batchId: l.batch_id,
      name: l.name,
      batchNo: l.batch_no,
      expiry: l.expiry,
      gstRate: l.gst_rate,
      soldQty: l.qty,
      alreadyReturned,
      returnable: returnableQty(basis),
      taxablePaise: l.taxable_paise,
      returnQty: 0,
    };
  });
}

/** The engine basis for a sale line: received = sold, taxable = the line's post-discount net. */
export function basisOf(line: SaleLineForReturn, alreadyReturned: number): ReturnBasis {
  return {
    receivedQty: line.qty,
    taxablePaise: line.taxable_paise,
    gstRate: line.gst_rate,
    returnedQty: alreadyReturned,
  };
}

/** One computed return line, ready for both the preview and the RPC payload. */
export interface ComputedReturnLine {
  line: ReturnEditorLine;
  netValuePaise: number;
  gstPaise: number;
  totalPaise: number;
  clamped: boolean;
}

export interface ComputedReturn {
  lines: ComputedReturnLine[];
  /** Only the lines with a positive return qty — what actually goes to the RPC. */
  active: ComputedReturnLine[];
  netValuePaise: number;
  gstPaise: number;
  totalPaise: number;
  /** True if any entered qty was clamped down to the returnable balance. */
  anyClamped: boolean;
}

/**
 * Compute the whole return on the engine. `interstate` (from the invoice) drives
 * the CGST/SGST-vs-IGST split. The engine clamps each line to its returnable
 * balance and apportions on the effective cost, so the credit-note totals come
 * off the discounted net, not the gross.
 */
export function computeReturn(lines: ReturnEditorLine[], interstate: boolean): ComputedReturn {
  const computed: ComputedReturnLine[] = lines.map((line) => {
    const r = recomputeReturn(basisOf(toBasisLine(line), line.alreadyReturned), line.returnQty, interstate);
    return {
      line,
      netValuePaise: r.netValuePaise,
      gstPaise: r.gstPaise,
      totalPaise: r.totalPaise,
      clamped: r.clamped,
    };
  });
  const active = computed.filter((c) => c.line.returnQty > 0);
  return {
    lines: computed,
    active,
    netValuePaise: active.reduce((s, c) => s + c.netValuePaise, 0),
    gstPaise: active.reduce((s, c) => s + c.gstPaise, 0),
    totalPaise: active.reduce((s, c) => s + c.totalPaise, 0),
    anyClamped: computed.some((c) => c.clamped),
  };
}

/** Adapt an editor line back to the minimal SaleLineForReturn the basis builder needs. */
function toBasisLine(l: ReturnEditorLine): SaleLineForReturn {
  return {
    id: l.saleLineId,
    item_id: l.itemId,
    batch_id: l.batchId,
    name: l.name,
    batch_no: l.batchNo,
    expiry: l.expiry,
    qty: l.soldQty,
    rate_paise: 0,
    gst_rate: l.gstRate,
    taxable_paise: l.taxablePaise,
    line_total_paise: 0,
  };
}

/** One line of the create_credit_note p_lines payload (snake_case to match the SQL). */
export interface CreditNoteLinePayload {
  sale_line_id: string;
  item_id: string | null;
  batch_id: string | null;
  name: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  rate_paise: number;
  gst_rate: number;
  /** Tax-inclusive return total for the line — the RPC backs the taxable + GST out of this. */
  line_total_paise: number;
}

/**
 * Build the create_credit_note p_lines from the computed return. line_total_paise
 * is the engine's tax-inclusive total (net + GST) so the RPC reverses exactly the
 * discounted value the engine computed. Only lines with qty > 0 are sent.
 */
export function buildCreditNoteLines(computed: ComputedReturn): CreditNoteLinePayload[] {
  return computed.active.map((c) => ({
    sale_line_id: c.line.saleLineId,
    item_id: c.line.itemId,
    batch_id: c.line.batchId,
    name: c.line.name,
    batch_no: c.line.batchNo,
    expiry: c.line.expiry,
    qty: c.line.returnQty,
    rate_paise: 0,
    gst_rate: c.line.gstRate,
    line_total_paise: c.totalPaise,
  }));
}
