import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

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
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const [rows, setRows] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);

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
        cols="1fr 1.4fr 0.9fr 0.9fr 0.9fr"
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
        ]}
      />
    </Page>
  );
}
