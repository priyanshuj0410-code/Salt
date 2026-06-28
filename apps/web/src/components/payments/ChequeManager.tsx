import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";

/**
 * Post-dated cheque management (SALT-060) — an in-module tab on /payments. Lists
 * cheque-mode payments with a due date and a pending → cleared / bounced
 * lifecycle, and surfaces what is coming due. Needs migration 0028
 * (`payments.cheque_due_date`). Edits write straight to `payments` (RLS-guarded).
 */
interface ChequeRow {
  id: string;
  party_id: string;
  direction: "received" | "paid";
  amount_paise: number;
  reference: string | null;
  status: string;
  cheque_due_date: string | null;
  payment_date: string;
}

const STATUSES = ["pending", "cleared", "bounced"] as const;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export function ChequeManager({ orgId, nameById }: { orgId: string | null; nameById: Map<string, string> }) {
  const [rows, setRows] = useState<ChequeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    selectAll<ChequeRow>((from, to) =>
      supabase!
        .from("payments")
        .select("id,party_id,direction,amount_paise,reference,status,cheque_due_date,payment_date")
        .eq("org_id", orgId)
        .eq("mode", "cheque")
        .order("cheque_due_date", { ascending: true, nullsFirst: false })
        .range(from, to),
    )
      .then((data) => {
        if (!active) return;
        setRows(data);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        const msg = e instanceof Error ? e.message : "Failed to load cheques";
        if (/cheque_due_date/.test(msg)) setNeedsMigration(true);
        else setError(msg);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  function patch(id: string, fields: Partial<ChequeRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    if (!supabase) return;
    supabase
      .from("payments")
      .update(fields)
      .eq("id", id)
      .then(({ error: err }) => {
        if (err) setError(err.message);
      });
  }

  const stats = useMemo(() => {
    const t = today();
    const in7 = addDays(7);
    const in30 = addDays(30);
    let pending = 0;
    let due7 = 0;
    let due30 = 0;
    let bounced = 0;
    for (const r of rows) {
      if (r.status === "bounced") bounced += r.amount_paise;
      if (r.status !== "pending") continue;
      pending += r.amount_paise;
      if (r.cheque_due_date && r.cheque_due_date <= in7) due7 += r.amount_paise;
      if (r.cheque_due_date && r.cheque_due_date >= t && r.cheque_due_date <= in30) due30 += r.amount_paise;
    }
    return { pending, due7, due30, bounced };
  }, [rows]);

  if (needsMigration) {
    return (
      <p className="mt-4 rounded-lg border border-warning-border bg-warning-bg px-3 py-6 text-sm text-warning">
        Post-dated cheque tracking needs migration <code>0028_payments_cheque_due_date.sql</code>. Run it in the Supabase
        SQL editor, then reload.
      </p>
    );
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={formatPaiseCompact(stats.pending)} valueTitle={formatPaise(stats.pending)} hint="cheques not yet cleared" />
        <StatCard label="Due ≤ 7 days" value={formatPaiseCompact(stats.due7)} valueTitle={formatPaise(stats.due7)} tone={stats.due7 ? "danger" : "default"} />
        <StatCard label="Due ≤ 30 days" value={formatPaiseCompact(stats.due30)} valueTitle={formatPaise(stats.due30)} />
        <StatCard label="Bounced" value={formatPaiseCompact(stats.bounced)} valueTitle={formatPaise(stats.bounced)} tone={stats.bounced ? "danger" : "default"} />
      </div>

      <div className="mt-4">
        <DataTable
          cols="0.9fr 1.3fr 0.6fr 0.9fr 0.9fr 0.9fr"
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={
            <p className="px-3 py-6 text-sm text-text-tertiary">
              No cheque payments yet. Record a payment with mode <b>Cheque</b>, then set its due date here.
            </p>
          }
          columns={[
            {
              key: "due",
              header: "Due date",
              cell: (r) => (
                <input
                  type="date"
                  value={r.cheque_due_date ?? ""}
                  onChange={(e) => patch(r.id, { cheque_due_date: e.target.value || null })}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
                />
              ),
            },
            { key: "party", header: "Party", cell: (r) => <span className="font-medium">{nameById.get(r.party_id) ?? "—"}</span> },
            {
              key: "dir",
              header: "Type",
              cell: (r) => (
                <Badge variant={r.direction === "received" ? "success" : "warning"}>
                  {r.direction === "received" ? "In" : "Out"}
                </Badge>
              ),
            },
            { key: "no", header: "Cheque no.", cell: (r) => <span className="font-mono text-xs">{r.reference || "—"}</span> },
            { key: "amt", header: "Amount", numeric: true, cell: (r) => formatPaise(r.amount_paise) },
            {
              key: "status",
              header: "Status",
              cell: (r) => (
                <select
                  value={r.status}
                  onChange={(e) => patch(r.id, { status: e.target.value })}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm capitalize outline-none focus-visible:border-ring"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
