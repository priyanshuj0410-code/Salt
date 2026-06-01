/**
 * Split-tender model + math for the counter (SALT-198). One bill can be settled by
 * several tenders — e.g. 200 cash + 300 UPI + 500 credit — instead of a single
 * payment method. The server (`create_sales_invoice` v2, migration 0034) is
 * authoritative: it re-validates that the tenders sum **exactly** to the invoice
 * total and that a credit leg has a party. These pure helpers mirror those guards
 * so the split pane can show a live remainder and gate Save before the round-trip.
 *
 * Money is integer paise throughout.
 */

/** Settlement modes — mirrors the `sale_tenders.mode` check (cash|card|upi|bank|credit). */
export const TENDER_MODES = ["cash", "card", "upi", "bank", "credit"] as const;
export type TenderMode = (typeof TENDER_MODES)[number];

/** One leg of a split payment. Serialized as an element of `p_tenders` for the RPC. */
export interface Tender {
  mode: TenderMode;
  amount_paise: number;
  /** UPI ref / card auth / cheque no — optional, stored on the tender row. */
  reference?: string;
}

/** Per-mode amounts as the split pane edits them; zero legs are dropped before sending. */
export type TenderAmounts = Record<TenderMode, number>;

export const NO_TENDERS: TenderAmounts = { cash: 0, card: 0, upi: 0, bank: 0, credit: 0 };

/** Clamp to a non-negative whole number of paise (inputs are user-entered rupees). */
function clean(n: number): number {
  return Math.max(0, Math.floor(n || 0));
}

/** Sum of all legs, in paise. */
export function tenderSum(amounts: TenderAmounts): number {
  return TENDER_MODES.reduce((s, m) => s + clean(amounts[m]), 0);
}

/** Still-unallocated amount, in paise (negative if over-tendered). */
export function tenderRemainder(amounts: TenderAmounts, grandPaise: number): number {
  return grandPaise - tenderSum(amounts);
}

/** The non-zero legs, as the `p_tenders` array the RPC expects (order: cash→credit). */
export function activeTenders(amounts: TenderAmounts): Tender[] {
  return TENDER_MODES.filter((m) => clean(amounts[m]) > 0).map((m) => ({
    mode: m,
    amount_paise: clean(amounts[m]),
  }));
}

export interface TenderCheck {
  /** Ready to save: at least one leg, sums exactly to the total, credit has a party. */
  ok: boolean;
  /** Total − sum, in paise (drives the live "Remaining" readout). */
  remainderPaise: number;
  /** A short reason when not ok (to disable Save / show inline); null when ok. */
  reason: string | null;
}

/**
 * Mirror of the server guards in `create_sales_invoice` (0034): the split must sum
 * **exactly** to the bill total, and a credit leg needs a customer. Drives both the
 * live remainder readout and the Save gate.
 */
export function checkTenders(
  amounts: TenderAmounts,
  grandPaise: number,
  hasParty: boolean,
): TenderCheck {
  const remainderPaise = tenderRemainder(amounts, grandPaise);
  const sum = tenderSum(amounts);
  let reason: string | null = null;
  if (sum === 0) reason = "Enter how the bill is split";
  else if (remainderPaise > 0) reason = "Split is short of the total";
  else if (remainderPaise < 0) reason = "Split is over the total";
  else if (clean(amounts.credit) > 0 && !hasParty) reason = "A credit portion needs a customer";
  return { ok: reason === null, remainderPaise, reason };
}
