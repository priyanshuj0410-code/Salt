import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { selectAll } from "@/lib/selectAll";
import { formatPaise, formatSigned, formatPaiseCompact } from "@/lib/currency";

/**
 * Cash-drawer reconciliation (SALT-059) — an in-module tab on /payments. Open a
 * shift with a starting float; the expected closing cash is the float plus the
 * net of CASH payments since the shift opened (received +, paid −); on close,
 * the counted cash is compared and the variance flagged. Per shop / shift, on
 * the existing `cash_drawer` table (0021), so no migration.
 */
interface DrawerRow {
  id: string;
  shift_date: string | null;
  opening_paise: number;
  closing_paise: number | null;
  expected_paise: number | null;
  variance_paise: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

const toPaise = (s: string) => Math.round((Number(s) || 0) * 100);

export function CashDrawer({ orgId }: { orgId: string | null }) {
  const shopId = useAuth().shopId;
  const userId = useAuth().user?.id ?? null;
  const [drawers, setDrawers] = useState<DrawerRow[]>([]);
  const [cashNet, setCashNet] = useState(0);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    selectAll<DrawerRow>((from, to) =>
      supabase!
        .from("cash_drawer")
        .select("id,shift_date,opening_paise,closing_paise,expected_paise,variance_paise,status,opened_at,closed_at")
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .order("opened_at", { ascending: false })
        .range(from, to),
    )
      .then((rows) => {
        if (active) setDrawers(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load cash drawer");
      });
    return () => {
      active = false;
    };
  }, [orgId, shopId, reloadKey]);

  const open = useMemo(() => drawers.find((d) => d.status === "open") ?? null, [drawers]);
  const closed = useMemo(() => drawers.filter((d) => d.status === "closed"), [drawers]);

  // Net CASH movement since the open shift started (received − paid).
  useEffect(() => {
    if (!supabase || !orgId || !shopId || !open) return;
    let active = true;
    (async () => {
      const rows = await selectAll<{ amount_paise: number; direction: string }>((from, to) =>
        supabase!
          .from("payments")
          .select("amount_paise,direction")
          .eq("org_id", orgId)
          .eq("shop_id", shopId)
          .eq("mode", "cash")
          .gte("created_at", open.opened_at)
          .range(from, to),
      );
      const net = rows.reduce((s, r) => s + (r.direction === "received" ? r.amount_paise : -r.amount_paise), 0);
      if (active) setCashNet(net);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId, shopId, open, reloadKey]);

  const expected = open ? open.opening_paise + cashNet : 0;
  const variancePreview = toPaise(counted) - expected;

  async function openDrawer() {
    if (!supabase || !orgId || !shopId || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("cash_drawer")
      .insert({ org_id: orgId, shop_id: shopId, opening_paise: toPaise(opening), status: "open", opened_by: userId });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOpening("");
    setReloadKey((k) => k + 1);
  }

  async function closeDrawer() {
    if (!supabase || !open || busy) return;
    const countedPaise = toPaise(counted);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("cash_drawer")
      .update({
        closing_paise: countedPaise,
        expected_paise: expected,
        variance_paise: countedPaise - expected,
        status: "closed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", open.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCounted("");
    setReloadKey((k) => k + 1);
  }

  if (!shopId) {
    return <p className="mt-4 text-sm text-text-tertiary">Select a shop to reconcile its cash drawer.</p>;
  }

  return (
    <div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {open ? (
        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Unlock className="size-4 text-success" />
            <h3 className="text-sm font-medium">
              Shift open since {format(new Date(open.opened_at), "d MMM, h:mm a")}
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Opening float" value={formatPaiseCompact(open.opening_paise)} valueTitle={formatPaise(open.opening_paise)} />
            <StatCard label="Net cash (shift)" value={formatSigned(cashNet)} tone={cashNet >= 0 ? "success" : "danger"} />
            <StatCard label="Expected in drawer" value={formatPaiseCompact(expected)} valueTitle={formatPaise(expected)} />
            <StatCard
              label="Variance"
              value={counted ? formatSigned(variancePreview) : "—"}
              tone={counted && variancePreview !== 0 ? "danger" : "default"}
              hint={counted ? (variancePreview === 0 ? "tallies" : variancePreview > 0 ? "surplus" : "short") : "enter counted cash"}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Counted cash (₹)</span>
              <Input
                type="number"
                min={0}
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                placeholder="0"
                className="h-9 w-40 text-right tabular-nums"
              />
            </label>
            <Button onClick={closeDrawer} disabled={busy || !counted}>
              <Lock /> {busy ? "Closing…" : "Close drawer"}
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-1 text-sm font-medium">Open a cash drawer</h3>
          <p className="mb-3 text-xs text-text-tertiary">Record the opening float to start a shift for this shop.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Opening float (₹)</span>
              <Input
                type="number"
                min={0}
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                placeholder="0"
                className="h-9 w-40 text-right tabular-nums"
              />
            </label>
            <Button onClick={openDrawer} disabled={busy || !opening}>
              <Unlock /> {busy ? "Opening…" : "Open drawer"}
            </Button>
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-text-primary">Past shifts</h3>
          <DataTable
            cols="1fr 0.9fr 0.9fr 0.9fr 0.9fr"
            rows={closed}
            rowKey={(d) => d.id}
            columns={[
              {
                key: "date",
                header: "Closed",
                cell: (d) => (
                  <span className="text-text-tertiary">
                    {d.closed_at ? format(new Date(d.closed_at), "d MMM yyyy, h:mm a") : "—"}
                  </span>
                ),
              },
              { key: "open", header: "Opening", numeric: true, cell: (d) => formatPaise(d.opening_paise) },
              {
                key: "exp",
                header: "Expected",
                numeric: true,
                cell: (d) => formatPaise(d.expected_paise ?? 0),
              },
              { key: "count", header: "Counted", numeric: true, cell: (d) => formatPaise(d.closing_paise ?? 0) },
              {
                key: "var",
                header: "Variance",
                numeric: true,
                cell: (d) => {
                  const v = d.variance_paise ?? 0;
                  return v === 0 ? (
                    <Badge variant="success">tallied</Badge>
                  ) : (
                    <span className="text-danger">{formatSigned(v)}</span>
                  );
                },
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
