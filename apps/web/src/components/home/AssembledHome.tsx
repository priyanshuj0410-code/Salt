import { LayoutGrid } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { ShopSelect } from "@/components/reports/report-controls";
import { scopeLabelFor } from "@/components/reports/useOrgShops";
import { useDashboardData, type DashboardData } from "@/components/reports/useDashboardData";
import { useAuth } from "@/lib/auth";
import { useLens } from "@/lib/lens/useLens";
import { assembledTiles } from "@/lib/lens/homeTiles";
import { useHomeSignals, SIGNAL_ATOMS } from "./useHomeSignals";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";
import type { AtomId } from "@/lib/lens/atoms";

type Tone = "default" | "success" | "danger";
interface Datum {
  value: string;
  valueTitle?: string;
  hint?: string;
  tone?: Tone;
}

/**
 * Reuse-tier tiles read straight off the shared Dashboard data (zero new queries).
 * Everything else is label-only for now — page-datum (D/E/I/J/K) and net-new
 * (A/G/N/O) tiles land in follow-on slices; until then they render as an "Open ->"
 * router into their surface, never a fake zero.
 */
function tileDatum(atom: AtomId, d: DashboardData): Datum | null {
  switch (atom) {
    case "B":
      return {
        value: formatPaiseCompact(d.todayTotalPaise),
        valueTitle: formatPaise(d.todayTotalPaise),
        hint: `${d.todayCount} ${d.todayCount === 1 ? "bill" : "bills"} today`,
      };
    case "L":
      return {
        value: formatPaiseCompact(d.todayTotalPaise),
        valueTitle: formatPaise(d.todayTotalPaise),
        hint: `${formatPaiseCompact(d.collectedPaise)} collected today`,
      };
    case "H":
      return {
        value: formatPaiseCompact(d.receivable.outstandingPaise),
        valueTitle: formatPaise(d.receivable.outstandingPaise),
        hint: `${formatPaiseCompact(d.receivable.over30Paise)} over 30 days`,
        tone: d.receivable.over30Paise > 0 ? "danger" : "default",
      };
    case "F":
      // C (dispense gate) signals H1/X today, which we don't compute yet — let it
      // fall through to an "Open ->" router rather than mislabel a near-expiry count.
      return d.nearExpiryCount > 0
        ? {
            value: `${d.nearExpiryCount} ${d.nearExpiryCount === 1 ? "batch" : "batches"}`,
            hint: `${formatPaiseCompact(d.nearExpiryValuePaise)} at risk`,
            tone: "danger",
          }
        : { value: "Clear", tone: "success" };
    default:
      return null;
  }
}

/**
 * The assembled signal-feed Home (WS3) — one tile per capability atom the user
 * holds, composed from one rule (assembledTiles), not seven hand-built Homes.
 * Reuse-tier tiles show live numbers off the shared Dashboard load; the rest are
 * "Open ->" routers into their surface. Flag-gated: only reached under LENS_V2
 * (the home surface / the landing redirect for watch-and-books users).
 */
export function AssembledHome() {
  const { shop } = useAuth();
  const lens = useLens();
  const { data, loading, shops, shopFilter, setShopFilter, today } = useDashboardData();
  const { signals, loading: signalsLoading } = useHomeSignals(lens);
  const tiles = assembledTiles(lens);
  const scopeLabel = scopeLabelFor(shops, shopFilter, shop?.name);

  return (
    <Page width="lg">
      <PageHeader
        icon={LayoutGrid}
        title="Home"
        subtitle={
          <span>
            {scopeLabel} · {today}
          </span>
        }
        actions={<ShopSelect shops={shops} value={shopFilter} onChange={setShopFilter} />}
      />
      {tiles.length === 0 ? (
        <EmptyState title="Just the counter" hint="Your work lives on the counter — nothing to watch here." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t) => {
            const reuse = tileDatum(t.atom, data);
            const isSignal = !reuse && SIGNAL_ATOMS.has(t.atom);
            const sig = isSignal ? signals[t.atom] : undefined;
            const datum = reuse ?? sig ?? null;
            const pending = reuse ? loading : isSignal ? signalsLoading && !sig : false;
            return (
              <NavLink key={t.atom} to={t.route} className="block">
                <StatCard
                  label={t.label}
                  value={pending ? "…" : datum ? datum.value : "Open →"}
                  valueTitle={reuse?.valueTitle}
                  hint={datum?.hint}
                  tone={datum?.tone}
                  className="h-full transition-colors hover:border-border-strong"
                />
              </NavLink>
            );
          })}
        </div>
      )}
    </Page>
  );
}
