/**
 * Client mirror of the date-effective GST rate schedule (SALT-081 / migration 0046) for the
 * counter (SALT-211). Medicine GST was overhauled at the 56th GST Council (HSN 3004: 12% → 5%,
 * effective 22 Sep 2025), so the rate for a line depends on the **invoice date**, not just the
 * item's flat `gst_rate`. We load `gst_rate_schedule` once and resolve client-side — same logic as
 * the server `gst_rate_for(p_class, p_on)`: the in-force row for a rate class on a date.
 */
export interface GstScheduleRow {
  rate_class: string; // std | ayush | nil | gst18 (see master_items.gst_rate_class)
  rate: number | string;
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null; // null = currently in force
}

/**
 * The GST rate (%) for `rateClass` on date `on` (YYYY-MM-DD), or null when the class is unknown /
 * the schedule has no row covering that date — the caller then falls back to the item's flat rate.
 * Mirrors `gst_rate_for`: the row with the latest `effective_from` whose range contains `on`.
 */
export function gstRateForClass(
  rateClass: string | null | undefined,
  on: string,
  schedule: GstScheduleRow[],
): number | null {
  if (!rateClass) return null;
  let best: GstScheduleRow | null = null;
  for (const r of schedule) {
    if (r.rate_class !== rateClass) continue;
    if (r.effective_from > on) continue;
    if (r.effective_to != null && r.effective_to < on) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best ? Number(best.rate) : null;
}

/** Today as a local YYYY-MM-DD (the counter's invoice date). `en-CA` formats as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA");
}
