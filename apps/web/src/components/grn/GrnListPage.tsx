import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Plus, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/currency";
import { updateScan } from "@/lib/invoiceScans";

interface GrnRow {
  id: string;
  grn_no: string | null;
  vendor_invoice_no: string | null;
  received_date: string | null;
  created_at: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  paid_paise: number;
  status: string;
  vendor: { name: string } | null;
}

const grnRef = (g: GrnRow) => g.vendor_invoice_no ?? g.grn_no ?? `#${g.id.slice(0, 8)}`;
const itc = (g: GrnRow) => g.cgst_paise + g.sgst_paise + g.igst_paise;

export function GrnListPage() {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const isOwner = membership?.role === "owner";
  const navigate = useNavigate();
  const [rows, setRows] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Pull-back (reverse) needs a deliberate second click (no native confirm).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [revErr, setRevErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("purchases")
      .select(
        "id,grn_no,vendor_invoice_no,received_date,created_at,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,status,vendor:ledgers(name)",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as GrnRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const totalTaxable = useMemo(() => rows.reduce((s, r) => s + r.taxable_paise, 0), [rows]);
  const totalItc = useMemo(() => rows.reduce((s, r) => s + itc(r), 0), [rows]);

  // Pull back (reverse) a posted GRN: delete_purchase (0058) fully undoes stock (on-hand
  // may go negative — the deliberate "purchase invoice missing" flag), vendor payable and
  // ITC, then removes the GRN. Owner-only (the RPC enforces it too). Any scan that posted
  // this GRN returns to the queue as re-postable (its FK link nulls on delete).
  async function doReverse(g: GrnRow) {
    if (!supabase) return;
    setReversing(g.id);
    setRevErr(null);
    try {
      const { data: linked } = await supabase.from("invoice_scans").select("id").eq("purchase_id", g.id);
      const { error } = await supabase.rpc("delete_purchase", { p_purchase_id: g.id });
      if (error) {
        setRevErr(`Could not pull back ${grnRef(g)}: ${error.message}`);
        return;
      }
      for (const s of (linked as { id: string }[] | null) ?? []) {
        await updateScan(s.id, { status: "extracted" });
      }
      setRows((rs) => rs.filter((x) => x.id !== g.id));
    } finally {
      setReversing(null);
      setConfirmId(null);
    }
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={Truck}
        title="Purchases"
        subtitle={rows.length > 0 ? `${rows.length} GRNs received` : "Goods received from vendors, newest first"}
        actions={
          <Button onClick={() => navigate("/purchases/new")}>
            <Plus /> Receive stock
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="GRNs" value={rows.length} />
        <StatCard label="Taxable purchases" value={formatPaise(totalTaxable)} />
        <StatCard label="ITC claimable" value={formatPaise(totalItc)} />
      </div>

      <DataTable<GrnRow>
        rows={rows}
        rowKey={(g) => g.id}
        cols="1fr 1.4fr 0.9fr 0.9fr 0.9fr auto"
        onRowActivate={(g) => navigate(`/purchases/${g.id}`)}
        loading={loading}
        empty={
          <EmptyState
            icon={Truck}
            title="No purchases yet"
            hint="Receive stock from a vendor to see GRNs here."
            action={
              <Button size="sm" onClick={() => navigate("/purchases/new")}>
                <Plus /> Receive stock
              </Button>
            }
          />
        }
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (g) => (
              <span className="text-text-tertiary">
                {format(new Date(g.received_date ?? g.created_at), "d MMM, yyyy")}
              </span>
            ),
          },
          {
            key: "vendor",
            header: "Vendor",
            cell: (g) => (
              <>
                {g.vendor?.name ?? "Vendor"}
                <span className="ml-1.5 text-xs text-text-tertiary">{grnRef(g)}</span>
              </>
            ),
          },
          { key: "taxable", header: "Taxable", numeric: true, cell: (g) => formatPaise(g.taxable_paise) },
          { key: "itc", header: "ITC", numeric: true, cell: (g) => <span className="text-text-tertiary">{formatPaise(itc(g))}</span> },
          {
            key: "total",
            header: "Total",
            numeric: true,
            cell: (g) => {
              const due = g.paid_paise < g.total_paise;
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Dot variant={due ? "warning" : "success"} />
                  {formatPaise(g.total_paise)}
                </span>
              );
            },
          },
          {
            // role="button" spans, not <button> — the row itself is a <button> when
            // onRowActivate is set, and nesting real buttons is invalid HTML.
            // stopPropagation keeps the click/Enter from also opening the GRN.
            key: "action",
            header: "",
            cell: (g) =>
              isOwner ? (
                <div className="flex justify-end">
                  {confirmId === g.id ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); if (reversing !== g.id) void doReverse(g); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void doReverse(g); } }}
                      className={cn("cursor-pointer text-xs font-medium text-destructive hover:underline", reversing === g.id && "pointer-events-none opacity-50")}
                    >
                      {reversing === g.id ? "Reversing…" : "Pull back GRN?"}
                    </span>
                  ) : (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setConfirmId(g.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setConfirmId(g.id); } }}
                      className="cursor-pointer text-text-tertiary hover:text-destructive"
                      aria-label="Pull back GRN"
                      title="Pull back (reverse) this GRN"
                    >
                      <Undo2 className="size-3.5" />
                    </span>
                  )}
                </div>
              ) : null,
          },
        ]}
      />

      {revErr && <p className="mt-3 text-sm text-destructive">{revErr}</p>}
    </Page>
  );
}
