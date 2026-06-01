import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CornerUpLeft, Plus } from "lucide-react";
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

interface DebitNoteRow {
  id: string;
  note_no: string | null;
  note_date: string | null;
  created_at: string;
  reason: string | null;
  taxable_paise: number;
  itc_reversal_paise: number;
  total_paise: number;
  status: string;
  vendor: { name: string } | null;
}

const noteRef = (d: DebitNoteRow) => d.note_no ?? `#${d.id.slice(0, 8)}`;

const STATUS_VARIANT: Record<string, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  placed: "success",
  cancelled: "danger",
};

export function DebitNoteListPage() {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const [rows, setRows] = useState<DebitNoteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("debit_notes")
      .select("id,note_no,note_date,created_at,reason,taxable_paise,itc_reversal_paise,total_paise,status,vendor:ledgers(name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as DebitNoteRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const totalReturned = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);
  const totalItcReversed = useMemo(() => rows.reduce((s, r) => s + r.itc_reversal_paise, 0), [rows]);

  return (
    <Page width="lg">
      <PageHeader
        icon={CornerUpLeft}
        title="Debit notes"
        subtitle={rows.length > 0 ? `${rows.length} purchase returns` : "Goods returned to vendors, newest first"}
        actions={
          <Button onClick={() => navigate("/purchases/returns/new")}>
            <Plus /> New return
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Debit notes" value={rows.length} />
        <StatCard label="Returned value" value={formatPaise(totalReturned)} />
        <StatCard label="ITC reversed" value={formatPaise(totalItcReversed)} />
      </div>

      <DataTable<DebitNoteRow>
        rows={rows}
        rowKey={(d) => d.id}
        cols="1fr 1.4fr 0.9fr 0.9fr 0.8fr"
        onRowActivate={(d) => navigate(`/purchases/returns/${d.id}`)}
        loading={loading}
        empty={
          <EmptyState
            icon={CornerUpLeft}
            title="No debit notes yet"
            hint="Return goods to a vendor to record a debit note."
            action={
              <Button size="sm" onClick={() => navigate("/purchases/returns/new")}>
                <Plus /> New return
              </Button>
            }
          />
        }
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (d) => (
              <span className="text-text-tertiary">{format(new Date(d.note_date ?? d.created_at), "d MMM, yyyy")}</span>
            ),
          },
          {
            key: "vendor",
            header: "Vendor",
            cell: (d) => (
              <>
                {d.vendor?.name ?? "Vendor"}
                <span className="ml-1.5 text-xs text-text-tertiary">{noteRef(d)}</span>
              </>
            ),
          },
          { key: "taxable", header: "Taxable", numeric: true, cell: (d) => formatPaise(d.taxable_paise) },
          { key: "itc", header: "ITC reversed", numeric: true, cell: (d) => <span className="text-text-tertiary">{formatPaise(d.itc_reversal_paise)}</span> },
          {
            key: "total",
            header: "Total",
            numeric: true,
            cell: (d) => (
              <span className="inline-flex items-center gap-1.5">
                <Badge variant={STATUS_VARIANT[d.status] ?? "neutral"}>{d.status}</Badge>
                {formatPaise(d.total_paise)}
              </span>
            ),
          },
        ]}
      />
    </Page>
  );
}
