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

/**
 * Split a GST-inclusive gross amount into taxable value and GST component.
 * MRP is inclusive of GST in Indian pharma retail, so we back it out.
 */
export function splitInclusiveGst(grossPaise: number, gstRate: number) {
  const taxable = Math.round(grossPaise / (1 + gstRate / 100));
  return { taxable, gst: grossPaise - taxable };
}
