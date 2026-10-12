import { BarChart3, Landmark, Package, Receipt, Settings, Sparkles, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/patterns/stat-card";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { ParseSummary } from "./ReceiptChat";

/**
 * The "Aha!" dashboard revealed after the receipt is (demo-)parsed — rendered
 * inside a `.dark` wrapper (see LandingPage) so it uses Salt's real dark tokens.
 * Shows the parsed result populated straight into a Salt-style dashboard; the
 * persistent "Enter Salt" CTA hands off to the real app ("/") via `onEnter`.
 * Wordmark uses Geist (matches the rest of the app).
 */
const NAV = [
  { icon: Receipt, label: "Billing" },
  { icon: Package, label: "Inventory" },
  { icon: Landmark, label: "GST" },
  { icon: Users, label: "Parties" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
] as const;

// Faux stock the bill "produced" (MRP in paise) — marketing preview only.
const SAMPLE = [
  { name: "Dolo 650mg Tablet", batch: "DL2411", qty: 240, mrpPaise: 3400 },
  { name: "Azithral 500 Tablet", batch: "AZ0325", qty: 60, mrpPaise: 13200 },
  { name: "Pan-D Capsule", batch: "PN1024", qty: 150, mrpPaise: 20400 },
  { name: "Shelcal 500 Tablet", batch: "SH0725", qty: 90, mrpPaise: 10800 },
  { name: "Augmentin 625 Duo", batch: "AG1224", qty: 40, mrpPaise: 19800 },
];

const COLS = "grid-cols-[1.7fr_0.8fr_0.5fr_0.8fr]";

export function DashboardReveal({
  onEnter,
  parsed,
}: {
  onEnter: () => void;
  parsed?: ParseSummary | null;
}) {
  const items = parsed?.items ?? 482;
  const vendors = parsed?.vendors ?? 18;
  const stockValuePaise = items * 45_000; // ~₹450 average, faux

  return (
    <div className="flex h-full w-full bg-background text-text-primary">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {NAV.map((n, i) => (
            <span
              key={n.label}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                i === 1 ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary",
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </span>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">Welcome to Salt</div>
            <div className="truncate text-xs text-text-tertiary">Aapki dukaan, ab cloud par</div>
          </div>
          <Button variant="primary" onClick={onEnter} className="shrink-0">
            Enter Salt →
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Parsed-result banner */}
            <div className="flex items-center gap-3 rounded-xl border border-success-border bg-success-bg px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <Sparkles className="size-5" />
              </span>
              <div className="min-w-0 text-sm">
                <span className="font-semibold text-text-primary">
                  Aapke bill se {items} items Salt mein aa gaye.
                </span>{" "}
                <span className="text-text-secondary">Stock, batches aur rates ready hain.</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard className="bg-surface" label="Items imported" value={String(items)} hint="is bill se" />
              <StatCard className="bg-surface" label="Vendors" value={String(vendors)} hint="auto-detected" />
              <StatCard
                className="bg-surface"
                label="Stock value (est.)"
                value={formatPaiseCompact(stockValuePaise)}
                valueTitle={formatPaise(stockValuePaise)}
                tone="success"
              />
              <StatCard className="bg-surface" label="Near expiry" value="12 batches" tone="danger" hint="dekhne layak" />
            </div>

            {/* Stock preview */}
            <div>
              <h2 className="mb-2 text-sm font-semibold text-text-secondary">Aapka naya stock</h2>
              <div className="overflow-hidden rounded-xl border border-border">
                <div
                  className={cn(
                    "grid gap-2 border-b border-border bg-surface-2/50 px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase",
                    COLS,
                  )}
                >
                  <span>Item</span>
                  <span>Batch</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">MRP</span>
                </div>
                {SAMPLE.map((r) => (
                  <div
                    key={r.name}
                    className={cn(
                      "grid gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-0",
                      COLS,
                    )}
                  >
                    <span className="truncate text-text-primary">{r.name}</span>
                    <span className="tabular-nums text-text-tertiary">{r.batch}</span>
                    <span className="text-right tabular-nums text-text-secondary">{r.qty}</span>
                    <span className="text-right tabular-nums text-text-primary">{formatPaise(r.mrpPaise)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                Pehle 5 items ka preview, poora {items}-item catalogue Salt ke andar ready hai.
              </p>
            </div>
          </div>
        </div>

        {/* Mobile bottom bar */}
        <nav className="flex items-center justify-around border-t border-border bg-surface px-2 py-2 md:hidden">
          {NAV.slice(0, 5).map((n, i) => (
            <span
              key={n.label}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[0.625rem]",
                i === 1 ? "text-text-primary" : "text-text-tertiary",
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </span>
          ))}
        </nav>
      </main>
    </div>
  );
}
