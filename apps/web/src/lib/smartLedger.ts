// Trial-balance-aware ledger extraction: parses a Saral/Marg/Tally trial
// balance into ledgers, their signed opening (outstanding) balances, and
// per-invoice open bills, plus quality checks. Pure (takes a sheet matrix).

export interface ParsedBill {
  refNo: string;
  billDate: string | null; // YYYY-MM-DD
  amountPaise: number;
  nature: "dr" | "cr" | null;
  dueDate: string | null;
  daysOverdue: number | null;
  valid: boolean;
}

export interface ParsedLedger {
  name: string;
  /** Signed outstanding balance in paise: + = receivable (Dr), - = payable (Cr). */
  openingBalancePaise: number;
  nature: "dr" | "cr" | null;
  phone: string;
  /** Column-identity check: prior-opening + debit - credit == closing. */
  balanced: boolean;
  /** prior-opening + debit - credit, in paise (for mismatch reporting). */
  computedClosingPaise: number;
  bills: ParsedBill[];
}

export interface LedgerReport {
  ledgers: ParsedLedger[];
  unparsedBillLines: number;
}

const SUMMARY = /^(grand total|total|sub ?total|opening balance|closing balance)\s*:?\s*$/i;
const DATE_RE = /\d{1,2}-\d{1,2}-\d{4}/;
const INLINE_BAL_RE = /^\(?[\d,]+(?:\.\d+)?\s*(dr|cr)\)?$/i; // e.g. "89997.00 Dr"
// Bill line, tolerant of leading "*** *" markers, blank ref, and contra
// amounts in parentheses e.g. "(39658.00 Dr)":
//   [markers] [ref?]  bill-date  [(]amount nature[)]  [due-date]  [days]
const BILL_RE =
  /^(.*?)\s*(\d{1,2}-\d{1,2}-\d{4})\s+\(?\s*([\d,]+(?:\.\d+)?)\s*(Dr|Cr)\s*\)?\s*(\d{1,2}-\d{1,2}-\d{4})?\s*(\d+)?\s*$/i;

const TOLERANCE = 100; // ₹1

function isPlainNumber(v: string): boolean {
  const s = v.replace(/[,₹\s]/g, "");
  return s !== "" && !/[a-z]/i.test(v) && Number.isFinite(Number(s));
}

function toPaise(s: string): number {
  return Math.round((Number(s.replace(/[^\d.]/g, "")) || 0) * 100);
}

function toIso(d: string): string | null {
  const m = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function parseBill(line: string): ParsedBill | null {
  const m = line.replace(/^[\s*]+/, "").match(BILL_RE);
  if (!m) return null;
  const billDate = toIso(m[2]);
  const amountPaise = toPaise(m[3]);
  const nature = m[4] ? (m[4].toLowerCase() as "dr" | "cr") : null;
  return {
    refNo: m[1].trim(),
    billDate,
    amountPaise,
    nature,
    dueDate: m[5] ? toIso(m[5]) : null,
    daysOverdue: m[6] ? Number(m[6]) : null,
    valid: Boolean(billDate) && amountPaise > 0 && nature !== null,
  };
}

interface ColumnMap {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

interface RowFinancials {
  nature: "dr" | "cr" | null;
  priorOpening: number; // signed paise
  debit: number; // paise
  credit: number; // paise
  closing: number; // signed paise
}

const NATURE_CELL = /^(dr|cr)$/i;

// Locate the opening/debit/credit/closing columns from the report header.
// Saral/Marg/Tally print a two-line header (OPENING | DEBIT CREDIT | CLOSING),
// so we merge labels from the matched row and the one below it. Reading values
// by fixed column index (rather than filtering blanks) keeps debit/credit/
// closing correctly aligned even when a column is empty for a given ledger.
function detectColumns(grid: string[][]): ColumnMap | null {
  const scan = Math.min(grid.length, 40);
  const idx = (re: RegExp, row: string[]) => row.findIndex((c) => re.test(c));
  for (let i = 0; i < scan; i++) {
    const row = grid[i];
    const opening = idx(/opening/i, row);
    const closing = idx(/closing/i, row);
    if (opening < 0 || closing < 0) continue;
    const next = grid[i + 1] ?? [];
    let debit = idx(/debit/i, row);
    let credit = idx(/credit/i, row);
    if (debit < 0) debit = idx(/debit/i, next);
    if (credit < 0) credit = idx(/credit/i, next);
    if (debit < 0) debit = opening + 1; // positional fallback
    if (credit < 0) credit = closing - 1;
    return { opening, debit, credit, closing };
  }
  return null;
}

function signedInline(cell: string): number {
  if (!cell) return 0;
  return /cr/i.test(cell) ? -toPaise(cell) : toPaise(cell);
}

// Read a ledger row's financials by fixed column index (preferred).
function readByColumns(cells: string[], cols: ColumnMap): RowFinancials {
  const natureCell = cells[cols.closing + 1] ?? "";
  const nature = NATURE_CELL.test(natureCell)
    ? (natureCell.toLowerCase() as "dr" | "cr")
    : ((cells.slice(1).find((c) => NATURE_CELL.test(c))?.toLowerCase() as "dr" | "cr" | undefined) ?? null);
  const closingMag = toPaise(cells[cols.closing] ?? "0");
  return {
    nature,
    priorOpening: signedInline(cells[cols.opening] ?? ""),
    debit: toPaise(cells[cols.debit] ?? "0"),
    credit: toPaise(cells[cols.credit] ?? "0"),
    closing: nature === "cr" ? -closingMag : closingMag,
  };
}

// Fallback when no header is found: infer columns from cell shapes. Plain
// numbers in order are [debit, credit, closing]; the inline Dr/Cr cell is the
// prior opening. Less reliable for the balance check when a column is blank.
function readByHeuristic(cells: string[]): RowFinancials {
  const rest = cells.slice(1);
  const closingNatureCell = rest.find((c) => NATURE_CELL.test(c));
  const nature = closingNatureCell ? (closingNatureCell.toLowerCase() as "dr" | "cr") : null;
  const openCell = rest.find((c) => INLINE_BAL_RE.test(c));
  const priorOpening = openCell ? signedInline(openCell) : 0;
  const plain = rest.filter(isPlainNumber);
  const closingMag = toPaise(plain[plain.length - 1] ?? "0");
  return {
    nature,
    priorOpening,
    debit: plain.length >= 3 ? toPaise(plain[plain.length - 3]) : 0,
    credit: plain.length >= 2 ? toPaise(plain[plain.length - 2]) : 0,
    closing: nature === "cr" ? -closingMag : closingMag,
  };
}

export function extractLedgerReport(matrix: string[][]): LedgerReport {
  const grid = matrix.map((r) => r.map((c) => (c ?? "").toString().trim()));
  const cols = detectColumns(grid);
  const isLedgerRow = (cells: string[]) => {
    const c0 = cells[0] ?? "";
    return c0 !== "" && !SUMMARY.test(c0) && cells.slice(1).some(isPlainNumber);
  };

  const ledgers: ParsedLedger[] = [];
  let current: ParsedLedger | null = null;
  let unparsed = 0;

  for (const cells of grid) {
    if (isLedgerRow(cells)) {
      const { nature, priorOpening, debit, credit, closing } = cols
        ? readByColumns(cells, cols)
        : readByHeuristic(cells);
      const computed = priorOpening + debit - credit;

      current = {
        name: cells[0],
        openingBalancePaise: closing,
        nature,
        phone: "",
        computedClosingPaise: computed,
        balanced: Math.abs(computed - closing) <= TOLERANCE,
        bills: [],
      };
      ledgers.push(current);
      continue;
    }

    const text = cells.find(Boolean) ?? "";
    if (!current || !text) continue;
    if (/^ph/i.test(text) && cells.filter(Boolean).length === 1) {
      current.phone = text.replace(/^ph\.?:?\s*/i, "");
    } else if (DATE_RE.test(text)) {
      const bill = parseBill(text);
      if (bill) current.bills.push(bill);
      else unparsed++;
    }
  }

  return { ledgers, unparsedBillLines: unparsed };
}

export interface LedgerQuality {
  ledgerCount: number;
  billCount: number;
  invalidBills: number;
  unparsedLines: number;
  /** Ledgers whose balance columns reconcile (opening + debit - credit = closing). */
  balanced: number;
  unbalanced: { name: string; closingPaise: number; computedPaise: number }[];
}

export function quality(report: LedgerReport): LedgerQuality {
  let billCount = 0;
  let invalidBills = 0;
  let balanced = 0;
  const unbalanced: LedgerQuality["unbalanced"] = [];

  for (const l of report.ledgers) {
    billCount += l.bills.length;
    invalidBills += l.bills.filter((b) => !b.valid).length;
    if (l.balanced) balanced++;
    else unbalanced.push({ name: l.name, closingPaise: l.openingBalancePaise, computedPaise: l.computedClosingPaise });
  }

  return {
    ledgerCount: report.ledgers.length,
    billCount,
    invalidBills,
    unparsedLines: report.unparsedBillLines,
    balanced,
    unbalanced,
  };
}
