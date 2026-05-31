import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ClipboardList, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

interface PoRow {
  id: string;
  po_no: string | null;
  po_date: string | null;
  created_at: string;
  expected_date: string | null;
  total_paise: number;
  status: string;
  vendor: { name: string } | null;
  po_lines: { count: number }[];
}

/** PO statuses that still expect goods (count toward "open"). */
const OPEN_STATUSES = new Set(["draft", "sent", "partial"]);

const poRef = (p: PoRow) => p.po_no ?? `#${p.id.slice(0, 8)}`;
const lineCount = (p: PoRow) => p.po_lines?.[0]?.count ?? 0;

const STATUS_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  sent: "info",
  partial: "warning",
  received: "success",
  closed: "neutral",
  cancelled: "danger",
};

export function PoListPage() {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("purchase_orders")
      .select("id,po_no,po_date,created_at,expected_date,total_paise,status,vendor:ledgers(name),po_lines(count)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as PoRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const openCount = useMemo(() => rows.filter((r) => OPEN_STATUSES.has(r.status)).length, [rows]);
  const openValue = useMemo(
    () => rows.filter((r) => OPEN_STATUSES.has(r.status)).reduce((s, r) => s + r.total_paise, 0),
    [rows],
  );

  return (
    <Page width="lg">
      <PageHeader
        icon={ClipboardList}
        title="Purchase orders"
        subtitle={rows.length > 0 ? `${rows.length} orders` : "Orders raised to vendors, newest first"}
        actions={
          <Button onClick={() => navigate("/purchases/orders/new")}>
            <Plus /> New order
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Orders" value={rows.length} />
        <StatCard label="Open orders" value={openCount} />
        <StatCard label="Open order value" value={formatPaise(openValue)} />
      </div>

      <DataTable<PoRow>
        rows={rows}
        rowKey={(p) => p.id}
        cols="1fr 1.4fr 0.7fr 0.9fr 0.8fr"
        onRowActivate={(p) => navigate(`/purchases/orders/${p.id}`)}
        loading={loading}
        empty={
          <EmptyState
            icon={ClipboardList}
            title="No purchase orders yet"
            hint="Raise an order to a vendor before the goods arrive."
            action={
              <Button size="sm" onClick={() => navigate("/purchases/orders/new")}>
                <Plus /> New order
              </Button>
            }
          />
        }
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (p) => (
              <span className="text-text-tertiary">{format(new Date(p.po_date ?? p.created_at), "d MMM, yyyy")}</span>
            ),
          },
          {
            key: "vendor",
            header: "Vendor",
            cell: (p) => (
              <>
                {p.vendor?.name ?? "Vendor"}
                <span className="ml-1.5 text-xs text-text-tertiary">{poRef(p)}</span>
              </>
            ),
          },
          { key: "items", header: "Items", numeric: true, cell: (p) => <span className="text-text-tertiary">{lineCount(p)}</span> },
          { key: "total", header: "Order value", numeric: true, cell: (p) => formatPaise(p.total_paise) },
          {
            key: "status",
            header: "Status",
            cell: (p) => <Badge variant={STATUS_VARIANT[p.status] ?? "neutral"}>{p.status}</Badge>,
          },
        ]}
      />
    </Page>
  );
}
