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
import { AgingTable } from "@/components/parties/AgingTable";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { useAuth } from "@/lib/auth";
import { suggestMerges, type MergeGroup } from "@/lib/mergeSuggest";
import { agingFor, type AgingBuckets } from "@/lib/aging";
import { upcomingPayments, UPCOMING_BANDS, type UpcomingBuckets } from "@/lib/cashflow";
import { INDIAN_STATE_CODES } from "@/lib/stateCodes";
import { CUSTOMER_GROUPS } from "@/lib/partyGroups";
import { cn } from "@/lib/utils";
import { cacheGet, cacheKey, cachePut, formatStaleness } from "@/lib/offline/cache";

interface LedgerRow {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  gstin: string | null;
  state_code: string | null;
  opening_balance_paise: number;
  customer_group?: string | null;
}

interface Party extends LedgerRow {
  billRefs: string[];
  billCount: number;
}

interface BillRow {
  ledger_id: string;
  ref_no: string | null;
  amount_paise: number;
  nature: string | null;
  due_date: string | null;
  bill_date: string | null;
  days_overdue: number | null;
}

/** A single scheduled vendor payment shown in the cash-flow panel. */
interface NextPayment {
  vendorId: string;
  vendorName: string;
  amountPaise: number;
  dueDate: string;
}

const rupees = (paise: number) =>
  (Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const fmtDueDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// A GSTIN's first two digits are its GST state code. Used to backfill a missing
// ledgers.state_code so create_sales_invoice splits CGST/SGST vs IGST correctly (SALT-054).
const VALID_STATE_CODES = new Set(INDIAN_STATE_CODES.map((s) => s.code));
const stateFromGstin = (gstin: string | null): string | null => {
  const code = gstin?.trim().slice(0, 2);
  return code && VALID_STATE_CODES.has(code) ? code : null;
};

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
  const [aging, setAging] = useState<{ receivable: AgingBuckets; payable: AgingBuckets } | null>(null);
  const [vendorPay, setVendorPay] = useState<{ buckets: UpcomingBuckets; next: NextPayment[] } | null>(null);
  const [retagging, setRetagging] = useState<string | null>(null);
  const [hasGroup, setHasGroup] = useState(false);
  /** When serving the offline read-cache, the epoch-ms it was written; null when live (SALT-207). */
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    // Page past the 1000-row cap — an org can have far more parties/bills.
    // customer_group (migration 0032) may not be applied yet — try the select
    // with it and fall back without, so the page still loads (SALT-048).
    const loadLedgers = async (): Promise<{ rows: LedgerRow[]; hasGroup: boolean }> => {
      const withGroup = () =>
        selectAll<LedgerRow>((from, to) =>
          supabase!
            .from("ledgers")
            .select("id,name,type,phone,gstin,state_code,opening_balance_paise,customer_group")
            .eq("org_id", orgId)
            .order("name")
            .range(from, to),
        );
      const withoutGroup = () =>
        selectAll<LedgerRow>((from, to) =>
          supabase!
            .from("ledgers")
            .select("id,name,type,phone,gstin,state_code,opening_balance_paise")
            .eq("org_id", orgId)
            .order("name")
            .range(from, to),
        );
      try {
        return { rows: await withGroup(), hasGroup: true };
      } catch (e) {
        if (e instanceof Error && e.message.includes("customer_group")) return { rows: await withoutGroup(), hasGroup: false };
        throw e;
      }
    };
    Promise.all([
      loadLedgers(),
      selectAll<BillRow>((from, to) =>
        supabase!
          .from("ledger_bills")
          .select("ledger_id,ref_no,amount_paise,nature,due_date,bill_date,days_overdue")
          .eq("org_id", orgId)
          .range(from, to),
      ),
    ])
      .then(([{ rows: ledgers, hasGroup: groupCol }, bills]) => {
        if (!active) return;
        setHasGroup(groupCol);
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
        // Cache the working set for offline reads (SALT-207); live data → no staleness hint.
        void cachePut(cacheKey("parties", orgId), parties);
        setCachedAt(null);
        // Org-wide aging from imported open bills (per-party view adds live orders).
        setAging(agingFor(bills, []));
        // Upcoming vendor payments (SALT-055): dated cr payables on vendor parties.
        const vendorName = new Map(
          ledgers.filter((l) => l.type === "vendor").map((l) => [l.id, l.name] as const),
        );
        const payables: NextPayment[] = bills
          .filter((b) => b.nature === "cr" && b.due_date && b.amount_paise > 0 && vendorName.has(b.ledger_id))
          .map((b) => ({
            vendorId: b.ledger_id,
            vendorName: vendorName.get(b.ledger_id)!,
            amountPaise: b.amount_paise,
            dueDate: b.due_date as string,
          }));
        const next = [...payables]
          .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
          .slice(0, 8);
        setVendorPay({ buckets: upcomingPayments(payables), next });
        setError(null);
        setLoading(false);
      })
      .catch(async (e) => {
        if (!active) return;
        // Offline / load failure → fall back to the last cached working set (SALT-207).
        const cached = await cacheGet<Party[]>(cacheKey("parties", orgId));
        if (!active) return;
        if (cached && cached.data.length > 0) {
          setRows(cached.data);
          setCachedAt(cached.cachedAt);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load parties");
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  // Re-tag a party's type inline from the list (fix import mistags without
  // opening the profile). Optimistic; reverts on error.
  async function retag(id: string, type: string) {
    if (!supabase || retagging) return;
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, type } : r)));
    setRetagging(id);
    setError(null);
    const { error: err } = await supabase.from("ledgers").update({ type }).eq("id", id);
    setRetagging(null);
    if (err) {
      setError(err.message);
      setRows(prev);
    }
  }

  // Set a party's customer group inline from the list (SALT-048). Optimistic;
  // reverts on error. Only reachable when the customer_group column exists.
  async function regroup(id: string, group: string) {
    if (!supabase || retagging) return;
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, customer_group: group || null } : r)));
    setRetagging(id);
    setError(null);
    const { error: err } = await supabase.from("ledgers").update({ customer_group: group || null }).eq("id", id);
    setRetagging(null);
    if (err) {
      setError(err.message);
      setRows(prev);
    }
  }

  // Backfill missing state_code from each party's GSTIN prefix, grouped into one
  // update per state, so the sales RPC can pick CGST/SGST vs IGST (SALT-054).
  async function fillStateFromGstin() {
    if (!supabase || busy) return;
    const byState = new Map<string, string[]>();
    for (const r of rows) {
      if (r.state_code) continue;
      const s = stateFromGstin(r.gstin);
      if (!s) continue;
      const arr = byState.get(s);
      if (arr) arr.push(r.id);
      else byState.set(s, [r.id]);
    }
    if (byState.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const [s, ids] of byState) {
        const { error: err } = await supabase.from("ledgers").update({ state_code: s }).in("id", ids);
        if (err) {
          setError(err.message);
          break;
        }
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

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

  // Parties with no state_code bill as intra-state (CGST+SGST) by default; count
  // them and how many can be auto-filled from their GSTIN prefix (SALT-054).
  const stateGap = useMemo(() => {
    let missing = 0, fillable = 0;
    for (const r of rows) {
      if (r.state_code) continue;
      missing++;
      if (stateFromGstin(r.gstin)) fillable++;
    }
    return { missing, fillable };
  }, [rows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.type.includes(q) ||
        (r.gstin ?? "").toLowerCase().includes(q) ||
        (r.customer_group ?? "").toLowerCase().includes(q),
    );
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

        {/* State coverage (SALT-054) — missing state_code defaults sales to intra-state CGST+SGST */}
        {!loading && stateGap.missing > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-warning-bg/50 p-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{stateGap.missing.toLocaleString("en-IN")}</span>{" "}
              part{stateGap.missing === 1 ? "y has" : "ies have"} no state set — their sales default to CGST+SGST (intra-state).
              {stateGap.fillable > 0
                ? ` ${stateGap.fillable.toLocaleString("en-IN")} can be filled from their GSTIN.`
                : " Add a state on each party to fix the GST split."}
            </span>
            {stateGap.fillable > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={fillStateFromGstin}>
                Fill {stateGap.fillable.toLocaleString("en-IN")} from GSTIN
              </Button>
            )}
          </div>
        )}

        {/* Aging of imported open bills (per-party view also counts live orders) */}
        {aging && (aging.receivable.total > 0 || aging.payable.total > 0) && (
          <section className="mt-4 rounded-lg border border-border p-4">
            <h2 className="text-sm font-medium text-text-primary">Aging of open bills</h2>
            <p className="mt-0.5 text-xs text-text-tertiary">
              Imported open bills by days overdue (₹). A party&rsquo;s own page also ages its live orders.
            </p>
            <div className="mt-3">
              <AgingTable receivable={aging.receivable} payable={aging.payable} />
            </div>
          </section>
        )}

        {/* Upcoming vendor payments (SALT-055) */}
        {vendorPay && vendorPay.buckets.total > 0 && (
          <section className="mt-4 rounded-lg border border-border p-4">
            <h2 className="text-sm font-medium text-text-primary">Upcoming vendor payments</h2>
            <p className="mt-0.5 text-xs text-text-tertiary">
              What you owe vendors, by due date (₹). From imported open bills that carry a due date.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {UPCOMING_BANDS.map((b) => (
                <div key={b.key} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs text-text-tertiary">{b.label}</div>
                  <div
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      b.key === "overdue" && vendorPay.buckets[b.key] > 0 ? "text-danger" : "",
                    )}
                  >
                    ₹{rupees(vendorPay.buckets[b.key])}
                  </div>
                </div>
              ))}
            </div>
            {vendorPay.next.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-text-tertiary">Next payments</div>
                <div className="divide-y divide-divider">
                  {vendorPay.next.map((p, i) => (
                    <Link
                      key={`${p.vendorId}-${i}`}
                      to={`/parties/${p.vendorId}`}
                      className="flex items-center gap-3 py-1.5 text-sm hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1 truncate">{p.vendorName}</span>
                      <span className="shrink-0 text-xs text-text-tertiary">{fmtDueDate(p.dueDate)}</span>
                      <span className="shrink-0 tabular-nums">₹{rupees(p.amountPaise)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        {cachedAt != null && (
          <p className="mt-4 text-sm text-warning">
            Offline — showing saved parties from {formatStaleness(cachedAt)}. Some figures may be out of date.
          </p>
        )}

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
            placeholder="Search by name, type, GSTIN or group…"
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
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface">
                  <Link
                    to={`/parties/${r.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none"
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
                        {[r.phone, r.gstin].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <Balance paise={r.opening_balance_paise} />
                      <div className="text-xs text-text-tertiary tabular-nums">{r.billCount} bills</div>
                    </div>
                  </Link>
                  {/* Inline group (SALT-048) — segment parties without opening the profile (desktop) */}
                  {hasGroup && (
                    <select
                      aria-label={`Group for ${r.name}`}
                      value={r.customer_group ?? ""}
                      disabled={retagging === r.id}
                      onChange={(e) => regroup(r.id, e.target.value)}
                      className="hidden h-8 shrink-0 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:border-ring disabled:opacity-50 sm:block"
                    >
                      <option value="">— group —</option>
                      {CUSTOMER_GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Inline re-tag (SALT-051) — fix mistags without opening the profile */}
                  <select
                    aria-label={`Type for ${r.name}`}
                    value={r.type}
                    disabled={retagging === r.id}
                    onChange={(e) => retag(r.id, e.target.value)}
                    className="h-8 shrink-0 rounded-md border border-input bg-background px-1.5 text-xs capitalize outline-none focus-visible:border-ring disabled:opacity-50"
                  >
                    <option value="customer">customer</option>
                    <option value="vendor">vendor</option>
                    <option value="other">other</option>
                  </select>
                  <Link to={`/parties/${r.id}`} className="shrink-0" aria-label={`Open ${r.name}`}>
                    <ChevronRight className="size-4 text-text-tertiary" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <CreatePartyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={reload}
          groupsEnabled={hasGroup}
        />
    </Page>
  );
}

