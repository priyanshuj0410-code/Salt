const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

/** Format an integer paise amount as en-IN currency, e.g. 123450 -> "₹1,234.50". */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
}

/**
 * Format a signed amount: "+₹5.00" for gains, "-₹5.00" for losses (the minus
 * comes from the currency formatter), "₹0.00" for zero.
 */
export function formatSigned(paise: number): string {
  return paise > 0 ? `+${formatPaise(paise)}` : formatPaise(paise);
}

// Indian-system magnitudes (in rupees): K = thousand, L = lakh (1e5), Cr = crore (1e7).
const COMPACT_TIERS: { limit: number; suffix: string }[] = [
  { limit: 1e7, suffix: "Cr" },
  { limit: 1e5, suffix: "L" },
  { limit: 1e3, suffix: "K" },
];

/**
 * Compact Indian money for space-constrained UI (KPI cards, table cells, chart
 * axes) where the full ₹12,34,567.00 would overflow: e.g. 123456700 paise ->
 * "₹12.3L", 1234500 -> "₹12.3K", 2500000000 -> "₹2.5Cr". Below ₹1,000 it shows
 * whole rupees (₹450). For exact values use `formatPaise` (this rounds). The
 * paired full value belongs in a tooltip (the truncate-everywhere primitive).
 */
export function formatPaiseCompact(paise: number, maxFraction = 1): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  const abs = Math.abs(rupees);
  const tier = COMPACT_TIERS.find((t) => abs >= t.limit);
  if (!tier) return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
  // Number(...).toString() trims trailing zeros: 5.0 -> "5", 1.20 -> "1.2".
  const n = Number((abs / tier.limit).toFixed(maxFraction));
  return `${sign}₹${n.toLocaleString("en-IN")}${tier.suffix}`;
}

/**
 * Split a GST-inclusive gross amount into taxable value and GST component.
 * MRP is inclusive of GST in Indian pharma retail, so we back it out.
 */
export function splitInclusiveGst(grossPaise: number, gstRate: number) {
  const taxable = Math.round(grossPaise / (1 + gstRate / 100));
  return { taxable, gst: grossPaise - taxable };
}
