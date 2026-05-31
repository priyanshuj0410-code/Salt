import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, GitMerge, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { CreatePartyDialog } from "@/components/parties/CreatePartyDialog";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { useAuth } from "@/lib/auth";
import { suggestMerges, type MergeGroup } from "@/lib/mergeSuggest";
import { cn } from "@/lib/utils";

interface LedgerRow {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  gstin: string | null;
  opening_balance_paise: number;
}

interface Party extends LedgerRow {
  billRefs: string[];
  billCount: number;
}

const rupees = (paise: number) =>
  (Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

// Soft-tinted avatar by party kind — quick visual scanning, never the only signal.
const typeTint = (type: string) =>
  type === "vendor"
    ? "bg-warning-bg text-warning"
    : type === "other"
      ? "bg-surface-2 text-text-secondary"
      : "bg-info-bg text-info";

function Balance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-muted-foreground">₹0</span>;
  const dr = paise > 0;
  return (
    <span className={dr ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      ₹{rupees(paise)} {dr ? "Dr" : "Cr"}
    </span>
  );
}

const REASON_LABEL: Record<MergeGroup["reason"], string> = {
  gstin: "same GSTIN",
  "invoice-set": "identical bills",
  name: "same name",
};

export function PartiesPage() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<Party[]>([]);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    // Page past the 1000-row cap — an org can have far more parties/bills.
    Promise.all([
      selectAll<LedgerRow>((from, to) =>
        supabase!
          .from("ledgers")
          .select("id,name,type,phone,gstin,opening_balance_paise")
          .eq("org_id", orgId)
          .order("name")
          .range(from, to),
      ),
      selectAll<{ ledger_id: string; ref_no: string | null }>((from, to) =>
        supabase!.from("ledger_bills").select("ledger_id,ref_no").eq("org_id", orgId).range(from, to),
      ),
    ])
      .then(([ledgers, bills]) => {
        if (!active) return;
        const refsByLedger = new Map<string, string[]>();
        for (const b of bills) {
          const arr = refsByLedger.get(b.ledger_id);
          if (arr) arr.push(b.ref_no ?? "");
          else refsByLedger.set(b.ledger_id, [b.ref_no ?? ""]);
        }
        const parties = ledgers.map((l) => {
          const refs = refsByLedger.get(l.id) ?? [];
          return { ...l, billRefs: refs, billCount: refs.length };
        });
        setRows(parties);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load parties");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const suggestions = useMemo(
    () =>
      suggestMerges(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          gstin: r.gstin,
          type: r.type,
          openingBalancePaise: r.opening_balance_paise,
          billRefs: r.billRefs,
          billCount: r.billCount,
        })),
      ),
    [rows],
  );

  const stats = useMemo(() => {
    let receivable = 0, payable = 0, bills = 0, customers = 0, vendors = 0, others = 0;
    for (const r of rows) {
      if (r.opening_balance_paise > 0) receivable += r.opening_balance_paise;
      else payable += -r.opening_balance_paise;
      bills += r.billCount;
      if (r.type === "vendor") vendors++;
      else if (r.type === "other") others++;
      else customers++;
    }
    return { receivable, payable, bills, customers, vendors, others, count: rows.length };
  }, [rows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.type.includes(q) || (r.gstin ?? "").toLowerCase().includes(q));
  }, [rows, filter]);

  const groupKey = (g: MergeGroup) => `${g.reason}:${g.label}`;
  const defaultSurvivor = (g: MergeGroup) => [...g.parties].sort((a, b) => b.billCount - a.billCount)[0].id;
  const survivorFor = (g: MergeGroup) => survivors[groupKey(g)] ?? defaultSurvivor(g);

  async function merge(g: MergeGroup) {
    if (!supabase) return;
    const survivorId = survivorFor(g);
    const mergedIds = g.parties.map((p) => p.id).filter((id) => id !== survivorId);
    if (mergedIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("merge_ledgers", { p_survivor: survivorId, p_merged: mergedIds });
      if (err) setError(err.message);
      else reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="lg">
        <PageHeader
          icon={Users}
          title="Parties"
          subtitle="Customers and vendors with their balances. Open a party to see history and edit details."
          actions={
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus /> New party
            </Button>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Parties" value={stats.count.toLocaleString("en-IN")} />
          <StatCard label="Customers" value={stats.customers.toLocaleString("en-IN")} />
          <StatCard label="Vendors" value={stats.vendors.toLocaleString("en-IN")} />
          <StatCard label="Other" value={stats.others.toLocaleString("en-IN")} />
          <StatCard label="Receivable" value={`₹${rupees(stats.receivable)}`} tone="success" />
          <StatCard label="Payable" value={`₹${rupees(stats.payable)}`} tone="danger" />
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        {/* Merge suggestions */}
        {suggestions.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitMerge className="size-4 text-amber-600" />
              {suggestions.length} possible duplicate{suggestions.length > 1 ? "s" : ""} to review
            </div>
            <div className="mt-2 space-y-2">
              {suggestions.map((g) => {
                const survivorId = survivorFor(g);
                return (
                  <div key={groupKey(g)} className="rounded-lg border bg-amber-500/5 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <Badge variant="outline">{REASON_LABEL[g.reason]}</Badge>
                      <span className="text-muted-foreground">pick the one to keep, then merge</span>
                    </div>
                    <div className="space-y-1.5">
                      {g.parties.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={groupKey(g)}
                            checked={p.id === survivorId}
                            onChange={() => setSurvivors((s) => ({ ...s, [groupKey(g)]: p.id }))}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                          <Badge variant="secondary">{p.type}</Badge>
                          <span className="w-16 text-right text-xs text-muted-foreground">{p.billCount} bills</span>
                          <span className="w-28 text-right text-xs">
                            <Balance paise={p.openingBalancePaise} />
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => merge(g)}>
                        <GitMerge />
                        Merge {g.parties.length} into 1
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        balances add up; bills move to the kept party
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mt-6 flex items-center gap-3">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, type or GSTIN…"
            className="h-9 max-w-xs"
          />
          <span className="text-xs text-text-tertiary">
            {visible.length === rows.length ? `${rows.length}` : `${visible.length} of ${rows.length}`} parties
          </span>
        </div>

        {/* Contacts list — read-only; open a party to view history and edit details */}
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {loading ? (
            <p className="p-4 text-sm text-text-tertiary">Loading…</p>
          ) : visible.length === 0 ? (
            rows.length === 0 ? (
              <div className="flex flex-col items-start gap-3 p-4">
                <p className="text-sm text-text-tertiary">No parties yet — import your ledgers, or add one by hand.</p>
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <UserPlus /> New party
                </Button>
              </div>
            ) : (
              <p className="p-4 text-sm text-text-tertiary">No parties match that filter.</p>
            )
          ) : (
            <div className="max-h-[64vh] divide-y divide-divider overflow-auto">
              {visible.map((r) => (
                <Link
                  key={r.id}
                  to={`/parties/${r.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      typeTint(r.type),
                    )}
                  >
                    {initials(r.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-xs text-text-tertiary">
                      <span className="capitalize">{r.type}</span>
                      {r.phone ? ` · ${r.phone}` : ""}
                      {r.gstin ? ` · ${r.gstin}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <Balance paise={r.opening_balance_paise} />
                    <div className="text-xs text-text-tertiary tabular-nums">{r.billCount} bills</div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <CreatePartyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={reload}
        />
    </Page>
  );
}

