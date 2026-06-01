import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/ui/dot";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { licenseStatus } from "@/lib/licenses";

/** A `drug_licenses` row, trimmed to what the renewal banner needs (per-org RLS). */
interface LicenseRow {
  id: string;
  license_type: string;
  license_no: string;
  expiry_date: string | null;
}

/**
 * Owner-dashboard banner for drug licenses expiring within 90 days (or already
 * expired). Reuses the 90 / 60 / 30-day banding from `lib/licenses`; persists until
 * the license is renewed (no dismiss — SALT-066). Links to Settings → Drug licenses.
 */
export function LicenseRenewalBanner() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<LicenseRow[]>([]);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("drug_licenses")
      .select("id,license_type,license_no,expiry_date")
      .eq("org_id", orgId)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        if (active) setRows((data as LicenseRow[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  // Expired or expiring within 90 days, most urgent first.
  const flagged = rows
    .map((row) => ({ row, status: licenseStatus(row) }))
    .filter((x) => x.status.attention)
    .sort((a, b) => a.status.sortKey - b.status.sortKey);

  if (flagged.length === 0) return null;

  const expiredCount = flagged.filter((x) => x.status.expired).length;
  // Container tone follows the most urgent band: red if expired / ≤30 days, else amber.
  const danger = flagged[0].status.variant === "danger";

  return (
    <section
      className={cn(
        "mt-5 rounded-lg border",
        danger ? "border-danger-border bg-danger-bg" : "border-warning-border bg-warning-bg",
      )}
      aria-label="Drug license renewals"
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", danger ? "text-danger" : "text-warning")} />
        <div className="min-w-0 flex-1">
          <h2 className={cn("text-sm font-medium", danger ? "text-danger" : "text-warning")}>
            {flagged.length === 1
              ? "1 drug license needs renewal"
              : `${flagged.length} drug licenses need renewal`}
            {expiredCount > 0 && ` — ${expiredCount} already expired`}
          </h2>
          <p className="text-xs text-text-secondary">
            Renew before expiry to keep dispensing legally.
          </p>
        </div>
      </div>

      <ul className="mt-2 divide-y border-t">
        {flagged.map(({ row, status }) => (
          <li key={row.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <ScrollText className="size-4 shrink-0 text-text-tertiary" />
            <span className="min-w-0 truncate">
              <span className="font-medium">{row.license_type}</span>
              <span className="ml-1.5 font-mono text-xs text-text-tertiary">{row.license_no}</span>
            </span>
            <span className="flex-1" />
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <Dot variant={status.variant} />
              <Badge variant={status.variant}>{status.label}</Badge>
            </span>
          </li>
        ))}
      </ul>

      <div className="px-4 py-2.5">
        <Link to="/settings/licenses" className="text-sm font-medium text-primary hover:underline">
          Manage licenses →
        </Link>
      </div>
    </section>
  );
}
