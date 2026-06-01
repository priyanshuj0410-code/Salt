import { parseISO } from "date-fns";

/**
 * Drug-license renewal status — the shared 90 / 60 / 30-day banding.
 *
 * Single source of truth for both Settings → Drug licenses (`DrugLicensesPage`) and
 * the owner-dashboard renewal banner (`LicenseRenewalBanner`, SALT-066) so the two
 * surfaces can never drift.
 */

/** Status colour band — the design-system status variants (design.md §5.3). */
export type LicenseStatusVariant = "danger" | "warning" | "info" | "success" | "neutral";

export interface LicenseStatus {
  label: string;
  variant: LicenseStatusVariant;
  /** Sort key: smaller = more urgent (expired/soonest first); no-expiry sorts last. */
  sortKey: number;
  /** Expired or expiring within 90 days — feeds the renewal alert. */
  attention: boolean;
  expired: boolean;
}

/** Whole-day difference from today (local midnight, so date-only strings don't drift). */
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseISO(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** The IA's 90 / 60 / 30-day renewal windows, plus expired and no-expiry. */
export function licenseStatus(l: { expiry_date: string | null }): LicenseStatus {
  if (!l.expiry_date) {
    return { label: "No expiry set", variant: "neutral", sortKey: Number.MAX_SAFE_INTEGER, attention: false, expired: false };
  }
  const days = daysUntil(l.expiry_date);
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, variant: "danger", sortKey: days, attention: true, expired: true };
  if (days <= 30) return { label: days === 0 ? "Expires today" : `Expires in ${days}d`, variant: "danger", sortKey: days, attention: true, expired: false };
  if (days <= 60) return { label: `Expires in ${days}d`, variant: "warning", sortKey: days, attention: true, expired: false };
  if (days <= 90) return { label: `Expires in ${days}d`, variant: "info", sortKey: days, attention: true, expired: false };
  return { label: "Valid", variant: "success", sortKey: days, attention: false, expired: false };
}
