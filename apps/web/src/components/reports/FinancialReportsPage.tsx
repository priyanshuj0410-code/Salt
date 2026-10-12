import { useEffect, useMemo, useState } from "react";
import { Landmark } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ViewTabs, RangeControls, ExportButton, type ReportView } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { fetchAllPaged } from "@/lib/reportData";
import {
  presetRange,
  sumAging,
  sumBy,
  buildTrialBalance,
  buildPnl,
  buildBalanceSheet,
  downloadCsv,
  paiseToRupeeStr,
  type AgingViewRow,
  type AccountEntry,
  type PnlLine,
} from "@/lib/reports";

interface AgingFetchRow {
  party_id?: string;
  vendor_id?: string;
  party_name?: string;
  vendor_name?: string;
  outstanding_paise: number;
  d0_30_paise: number;
  d31_60_paise: number;
  d61_90_paise: number;
  d90_plus_paise: number;
}
interface LedgerEntryRow {
  id: string;
  entry_date: string;
  debit_paise: number;
  credit_paise: number;
  narration: string | null;
  chart_accounts: { code: string; name: string; type: string } | null;
  ledgers: { name: string | null } | null;
}
interface TbFetchRow {
  code: string | null;
  name: string;
  type: string;
  balance_paise: number;
}
interface BsFetchRow {
  type: string;
  name: string;
  balance_paise: number;
}
interface PnlFetchRow {
  amount_paise: number;
}
interface SaleMoveRow {
  qty_delta: number;
  unit_cost_paise: number;
}

type ViewKey = "receivables" | "payables" | "pnl" | "balancesheet" | "trialbalance" | "daybook" | "cashbook" | "bankbook" | "margin";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "receivables", label: "Receivables" },
  { key: "payables", label: "Payables" },
  { key: "pnl", label: "P&L" },
  { key: "balancesheet", label: "Balance sheet" },
  { key: "trialbalance", label: "Trial balance" },
  { key: "daybook", label: "Day book" },
  { key: "cashbook", label: "Cash book" },
  { key: "bankbook", label: "Bank book" },
  { key: "margin", label: "Margin" },
];

/** Views whose figures depend on the date range (vs. as-of-now statements). */
const RANGED: ViewKey[] = ["pnl", "daybook", "cashbook", "bankbook", "margin"];

export function FinancialReportsPage() {
  const { membership, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [range, setRange] = useState(() => presetRange("month"));
  const [view, setView] = useState<ViewKey>("receivables");
  const [recv, setRecv] = useState<AgingViewRow[]>([]);
  const [pay, setPay] = useState<AgingViewRow[]>([]);
  const [tb, setTb] = useState<TbFetchRow[]>([]);
  const [bs, setBs] = useState<BsFetchRow[]>([]);
  const [retainedPaise, setRetainedPaise] = useState(0);
  const [entries, setEntries] = useState<LedgerEntryRow[]>([]);
  const [saleMoves, setSaleMoves] = useState<SaleMoveRow[]>([]);
  const [snapLoading, setSnapLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(true);

  // As-of statements + aging (cumulative; independent of the range).
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const db = supabase;
    (async () => {
      setSnapLoading(true);
      const [r, p, t, b, pnl] = await Promise.all([
        fetchAllPaged<AgingFetchRow>((f, t) =>
          db.from("v_receivables_aging").select("party_id,party_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise").eq("org_id", orgId).range(f, t),
        ),
        fetchAllPaged<AgingFetchRow>((f, t) =>
          db.from("v_payables_aging").select("vendor_id,vendor_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise").eq("org_id", orgId).range(f, t),
        ),
        fetchAllPaged<TbFetchRow>((f, t) => db.from("v_trial_balance").select("code,name,type,balance_paise").eq("org_id", orgId).range(f, t)),
        fetchAllPaged<BsFetchRow>((f, t) => db.from("v_balance_sheet").select("type,name,balance_paise").eq("org_id", orgId).range(f, t)),
        fetchAllPaged<PnlFetchRow>((f, t) => db.from("v_pnl").select("amount_paise").eq("org_id", orgId).range(f, t)),
      ]);
      if (!active) return;
      setRecv(r.map((x) => ({ ...x, party_id: x.party_id ?? "", name: x.party_name ?? "-" })));
      setPay(p.map((x) => ({ ...x, party_id: x.vendor_id ?? "", name: x.vendor_name ?? "-" })));
      setTb(t);
      setBs(b);
      setRetainedPaise(sumBy(pnl, (x) => x.amount_paise));
      setSnapLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId]);

  // Period ledger entries (books + period P&L) + sale movements (COGS).
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const db = supabase;
    const { from, to } = range;
    (async () => {
      setRangeLoading(true);
      const [es, mv] = await Promise.all([
        fetchAllPaged<LedgerEntryRow>((f, t) =>
          db
            .from("ledger_entries")
            .select("id,entry_date,debit_paise,credit_paise,narration,chart_accounts(code,name,type),ledgers(name)")
            .eq("org_id", orgId)
            .gte("entry_date", from)
            .lte("entry_date", to)
            .order("entry_date", { ascending: true })
            .range(f, t),
        ),
        fetchAllPaged<SaleMoveRow>((f, t) =>
          db
            .from("stock_movements")
            .select("qty_delta,unit_cost_paise,reason,created_at")
            .eq("org_id", orgId)
            .eq("reason", "sale")
            .gte("created_at", from)
            .lte("created_at", `${to}T23:59:59`)
            .range(f, t),
        ),
      ]);
      if (!active) return;
      setEntries(es);
      setSaleMoves(mv);
      setRangeLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, range]);

  const recvTotals = useMemo(() => sumAging(recv), [recv]);
  const payTotals = useMemo(() => sumAging(pay), [pay]);
  const trial = useMemo(() => buildTrialBalance(tb), [tb]);
  const accountEntries = useMemo<AccountEntry[]>(
    () =>
      entries
        .filter((e) => e.chart_accounts)
        .map((e) => ({ debitPaise: e.debit_paise, creditPaise: e.credit_paise, type: e.chart_accounts!.type, name: e.chart_accounts!.name })),
    [entries],
  );
  const pnl = useMemo(() => buildPnl(accountEntries), [accountEntries]);
  const balanceSheet = useMemo(() => buildBalanceSheet(bs, retainedPaise), [bs, retainedPaise]);

  const cashBook = useMemo(() => entries.filter((e) => e.chart_accounts?.code === "CASH"), [entries]);
  const bankBook = useMemo(() => entries.filter((e) => e.chart_accounts?.code === "BANK"), [entries]);

  const margin = useMemo(() => {
    const revenue = sumBy(
      entries.filter((e) => e.chart_accounts?.code === "SALES"),
      (e) => e.credit_paise - e.debit_paise,
    );
    const cogs = sumBy(saleMoves, (m) => -m.qty_delta * m.unit_cost_paise);
    const grossProfit = revenue - cogs;
    const pct = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;
    return { revenue, cogs, grossProfit, pct };
  }, [entries, saleMoves]);

  const periodTag = `${range.from}_${range.to}`;
  const exporters: Record<ViewKey, () => void> = {
    receivables: () => exportAging("receivables", recv),
    payables: () => exportAging("payables", pay),
    pnl: () =>
      downloadCsv(
        `pnl-${periodTag}.csv`,
        ["Section", "Account", "Amount"],
        [
          ...pnl.income.map((l) => ["Income", l.name, paiseToRupeeStr(l.amountPaise)]),
          ...pnl.expense.map((l) => ["Expense", l.name, paiseToRupeeStr(l.amountPaise)]),
          ["Net", pnl.netPaise >= 0 ? "Profit" : "Loss", paiseToRupeeStr(pnl.netPaise)],
        ] as (string | number)[][],
      ),
    balancesheet: () =>
      downloadCsv(
        "balance-sheet.csv",
        ["Section", "Account", "Amount"],
        [
          ...balanceSheet.assets.map((l) => ["Asset", l.name, paiseToRupeeStr(l.amountPaise)]),
          ...balanceSheet.liabilities.map((l) => ["Liability", l.name, paiseToRupeeStr(l.amountPaise)]),
          ...balanceSheet.equity.map((l) => ["Equity", l.name, paiseToRupeeStr(l.amountPaise)]),
        ] as (string | number)[][],
      ),
    trialbalance: () =>
      downloadCsv(
        "trial-balance.csv",
        ["Code", "Account", "Debit", "Credit"],
        trial.lines.map((l) => [l.code ?? "", l.name, paiseToRupeeStr(l.debitPaise), paiseToRupeeStr(l.creditPaise)]),
      ),
    daybook: () =>
      downloadCsv(
        `day-book-${periodTag}.csv`,
        ["Date", "Particulars", "Narration", "Debit", "Credit"],
        entries.map((e) => [e.entry_date, e.chart_accounts?.name ?? e.ledgers?.name ?? "-", e.narration ?? "", paiseToRupeeStr(e.debit_paise), paiseToRupeeStr(e.credit_paise)]),
      ),
    cashbook: () => exportBook("cash-book", cashBook),
    bankbook: () => exportBook("bank-book", bankBook),
    margin: () =>
      downloadCsv(
        `margin-${periodTag}.csv`,
        ["Metric", "Amount"],
        [
          ["Revenue (ex-GST)", paiseToRupeeStr(margin.revenue)],
          ["COGS", paiseToRupeeStr(margin.cogs)],
          ["Gross profit", paiseToRupeeStr(margin.grossProfit)],
          ["Margin %", String(margin.pct)],
        ],
      ),
  };

  function exportAging(name: string, rows: AgingViewRow[]) {
    downloadCsv(
      `${name}-aging.csv`,
      ["Party", "0-30", "31-60", "61-90", "90+", "Outstanding"],
      rows.map((r) => [r.name, paiseToRupeeStr(r.d0_30_paise), paiseToRupeeStr(r.d31_60_paise), paiseToRupeeStr(r.d61_90_paise), paiseToRupeeStr(r.d90_plus_paise), paiseToRupeeStr(r.outstanding_paise)]),
    );
  }
  function exportBook(name: string, rows: LedgerEntryRow[]) {
    let bal = 0;
    downloadCsv(
      `${name}-${periodTag}.csv`,
      ["Date", "Narration", "Debit", "Credit", "Balance"],
      rows.map((e) => {
        bal += e.debit_paise - e.credit_paise;
        return [e.entry_date, e.narration ?? "", paiseToRupeeStr(e.debit_paise), paiseToRupeeStr(e.credit_paise), paiseToRupeeStr(bal)];
      }),
    );
  }

  const isRanged = RANGED.includes(view);

  return (
    <Page width="lg">
      <PageHeader
        icon={Landmark}
        title="Financial reports"
        subtitle={<span>{membership?.orgName ?? "Organisation"} · organisation-wide</span>}
        actions={
          <>
            {isRanged && <RangeControls from={range.from} to={range.to} onChange={setRange} />}
            <ExportButton onExport={exporters[view]} disabled={false} />
          </>
        }
      />

      {authLoading || orgId ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Receivables" value={formatPaise(recvTotals.outstandingPaise)} hint={`${recvTotals.parties} parties · ${formatPaise(recvTotals.over30Paise)} >30d`} />
            <StatCard label="Payables" value={formatPaise(payTotals.outstandingPaise)} hint={`${payTotals.parties} vendors`} />
            <StatCard
              label="Net P&L (period)"
              value={formatPaise(pnl.netPaise)}
              tone={pnl.netPaise >= 0 ? "success" : "danger"}
              hint={pnl.netPaise >= 0 ? "profit" : "loss"}
            />
            <StatCard label="Gross margin (period)" value={`${margin.pct}%`} hint={formatPaise(margin.grossProfit)} />
          </div>

          <ViewTabs views={VIEWS} value={view} onChange={setView} />

          {(view === "receivables" || view === "payables") && (
            <AgingTable rows={view === "receivables" ? recv : pay} totals={view === "receivables" ? recvTotals : payTotals} loading={snapLoading} kind={view} />
          )}

          {view === "pnl" && <PnlStatement pnl={pnl} loading={rangeLoading} range={range} />}

          {view === "balancesheet" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <StatementSection title="Assets" lines={balanceSheet.assets} total={balanceSheet.assetsTotalPaise} totalLabel="Total assets" loading={snapLoading} />
              <StatementSection
                title="Liabilities & equity"
                lines={[...balanceSheet.liabilities, ...balanceSheet.equity]}
                total={balanceSheet.liabilitiesAndEquityTotalPaise}
                totalLabel="Total liabilities & equity"
                loading={snapLoading}
              />
              <p className="text-xs text-text-tertiary lg:col-span-2">
                As-of now (inception-to-date). Retained earnings folds all-time net P&L into equity so the sheet balances.
              </p>
            </div>
          )}

          {view === "trialbalance" && (
            <div className="flex flex-col gap-2">
              <DataTable
                cols="0.8fr 2fr 1fr 1fr"
                rows={trial.lines}
                rowKey={(r) => `${r.code ?? ""}:${r.name}`}
                loading={snapLoading}
                empty={<EmptyState title="No ledger activity" hint="Posted documents build the trial balance." />}
                columns={[
                  { key: "code", header: "Code", cell: (r) => <span className="tabular-nums">{r.code ?? "-"}</span> },
                  { key: "name", header: "Account", cell: (r) => r.name },
                  { key: "dr", header: "Debit", numeric: true, cell: (r) => (r.debitPaise ? formatPaise(r.debitPaise) : "-") },
                  { key: "cr", header: "Credit", numeric: true, cell: (r) => (r.creditPaise ? formatPaise(r.creditPaise) : "-") },
                ]}
              />
              <div className="flex justify-end gap-6 px-3 text-sm">
                <span className="text-text-secondary">
                  Total Dr <span className="font-semibold tabular-nums text-text-primary">{formatPaise(trial.totalDebitPaise)}</span>
                </span>
                <span className="text-text-secondary">
                  Total Cr <span className="font-semibold tabular-nums text-text-primary">{formatPaise(trial.totalCreditPaise)}</span>
                </span>
                <span className={trial.totalDebitPaise === trial.totalCreditPaise ? "text-success" : "text-danger"}>
                  {trial.totalDebitPaise === trial.totalCreditPaise ? "Balanced" : "Out of balance"}
                </span>
              </div>
            </div>
          )}

          {view === "daybook" && (
            <DataTable
              cols="0.8fr 1.3fr 1.6fr 1fr 1fr"
              rows={entries}
              rowKey={(e) => e.id}
              loading={rangeLoading}
              empty={<EmptyState title="No entries in range" hint="Every posted document writes balanced ledger entries." />}
              columns={[
                { key: "date", header: "Date", cell: (e) => e.entry_date },
                { key: "part", header: "Particulars", cell: (e) => e.chart_accounts?.name ?? e.ledgers?.name ?? "-" },
                { key: "narr", header: "Narration", cell: (e) => e.narration ?? "-" },
                { key: "dr", header: "Debit", numeric: true, cell: (e) => (e.debit_paise ? formatPaise(e.debit_paise) : "-") },
                { key: "cr", header: "Credit", numeric: true, cell: (e) => (e.credit_paise ? formatPaise(e.credit_paise) : "-") },
              ]}
            />
          )}

          {(view === "cashbook" || view === "bankbook") && (
            <BookTable rows={view === "cashbook" ? cashBook : bankBook} loading={rangeLoading} label={view === "cashbook" ? "Cash" : "Bank"} />
          )}

          {view === "margin" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Revenue (ex-GST)" value={formatPaise(margin.revenue)} />
                <StatCard label="COGS" value={formatPaise(margin.cogs)} hint="from sale stock movements" />
                <StatCard label="Gross profit" value={formatPaise(margin.grossProfit)} tone={margin.grossProfit >= 0 ? "success" : "danger"} />
                <StatCard label="Gross margin" value={`${margin.pct}%`} />
              </div>
              <p className="text-xs text-text-tertiary">
                Gross margin = revenue (posted Sales) − COGS (cost on sale stock movements) for the range. Accrual P&L (the
                P&L tab) expenses purchases when received; a cash-basis P&L is future work.
              </p>
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            From the double-entry ledger. Statements are organisation-wide. Receivables / payables / balance sheet / trial
            balance are as-of-now; P&L, day / cash / bank book and margin cover the selected range.
          </p>
        </div>
      ) : (
        <EmptyState title="No organisation" hint="Join or create an organisation to see financial reports." />
      )}
    </Page>
  );
}

function AgingTable({
  rows,
  totals,
  loading,
  kind,
}: {
  rows: AgingViewRow[];
  totals: ReturnType<typeof sumAging>;
  loading: boolean;
  kind: "receivables" | "payables";
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.outstanding_paise - a.outstanding_paise), [rows]);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="0-30" value={formatPaise(totals.d0_30Paise)} />
        <StatCard label="31-60" value={formatPaise(totals.d31_60Paise)} />
        <StatCard label="61-90" value={formatPaise(totals.d61_90Paise)} />
        <StatCard label="90+" value={formatPaise(totals.d90_plusPaise)} tone={totals.d90_plusPaise > 0 ? "danger" : "default"} />
      </div>
      <DataTable
        cols="1.6fr 1fr 1fr 1fr 1fr 1.1fr"
        rows={sorted}
        rowKey={(r) => r.party_id || r.name}
        loading={loading}
        empty={<EmptyState title={`No ${kind} outstanding`} />}
        columns={[
          { key: "name", header: kind === "receivables" ? "Customer" : "Vendor", cell: (r) => r.name },
          { key: "d1", header: "0-30", numeric: true, cell: (r) => formatPaise(r.d0_30_paise) },
          { key: "d2", header: "31-60", numeric: true, cell: (r) => formatPaise(r.d31_60_paise) },
          { key: "d3", header: "61-90", numeric: true, cell: (r) => formatPaise(r.d61_90_paise) },
          { key: "d4", header: "90+", numeric: true, cell: (r) => <span className={r.d90_plus_paise > 0 ? "text-danger" : undefined}>{formatPaise(r.d90_plus_paise)}</span> },
          { key: "out", header: "Outstanding", numeric: true, cell: (r) => <span className="font-medium">{formatPaise(r.outstanding_paise)}</span> },
        ]}
      />
    </div>
  );
}

function PnlStatement({ pnl, loading, range }: { pnl: ReturnType<typeof buildPnl>; loading: boolean; range: { from: string; to: string } }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-secondary">
        {range.from} → {range.to} · accrual basis
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <StatementSection title="Income" lines={pnl.income} total={pnl.incomeTotalPaise} totalLabel="Total income" loading={loading} />
        <StatementSection title="Expenses" lines={pnl.expense} total={pnl.expenseTotalPaise} totalLabel="Total expenses" loading={loading} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
        <span className="text-sm font-medium text-text-secondary">{pnl.netPaise >= 0 ? "Net profit" : "Net loss"}</span>
        <span className={`text-lg font-semibold tabular-nums ${pnl.netPaise >= 0 ? "text-success" : "text-danger"}`}>{formatPaise(pnl.netPaise)}</span>
      </div>
    </div>
  );
}

function StatementSection({ title, lines, total, totalLabel, loading }: { title: string; lines: PnlLine[]; total: number; totalLabel: string; loading: boolean }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <h2 className="border-b border-border bg-surface px-3 py-2 text-sm font-semibold text-text-secondary">{title}</h2>
      {loading ? (
        <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
      ) : lines.length === 0 ? (
        <p className="px-3 py-6 text-sm text-text-tertiary">Nothing here.</p>
      ) : (
        <div className="divide-y divide-divider">
          {lines.map((l) => (
            <div key={l.name} className="flex items-center justify-between px-3 py-1.5 text-sm">
              <span className="text-text-primary">{l.name}</span>
              <span className="tabular-nums text-text-secondary">{formatPaise(l.amountPaise)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-2 text-sm font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{formatPaise(total)}</span>
      </div>
    </section>
  );
}

function BookTable({ rows, loading, label }: { rows: LedgerEntryRow[]; loading: boolean; label: string }) {
  // Running balance (Dr-normal: balance += debit − credit) over the ascending entries.
  const withBalance = useMemo(() => {
    const out: { e: LedgerEntryRow; bal: number }[] = [];
    let bal = 0;
    for (const e of rows) {
      bal += e.debit_paise - e.credit_paise;
      out.push({ e, bal });
    }
    return out;
  }, [rows]);
  return (
    <DataTable
      cols="0.9fr 2fr 1fr 1fr 1.1fr"
      rows={withBalance}
      rowKey={(r) => r.e.id}
      loading={loading}
      empty={<EmptyState title={`No ${label.toLowerCase()} movements in range`} hint={`${label} receipts and payments post here.`} />}
      columns={[
        { key: "date", header: "Date", cell: (r) => r.e.entry_date },
        { key: "narr", header: "Narration", cell: (r) => r.e.narration ?? "-" },
        { key: "dr", header: "Receipt", numeric: true, cell: (r) => (r.e.debit_paise ? formatPaise(r.e.debit_paise) : "-") },
        { key: "cr", header: "Payment", numeric: true, cell: (r) => (r.e.credit_paise ? formatPaise(r.e.credit_paise) : "-") },
        { key: "bal", header: "Balance", numeric: true, cell: (r) => formatPaise(r.bal) },
      ]}
    />
  );
}
