import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, CornerUpLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

interface DnHead {
  id: string;
  note_no: string | null;
  note_date: string | null;
  created_at: string;
  reason: string | null;
  is_interstate: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  itc_reversal_paise: number;
  total_paise: number;
  status: string;
  notes: string | null;
  vendor: { name: string } | null;
}

interface DnLine {
  id: string;
  name: string;
  batch_no: string | null;
  qty: number;
  ptr_paise: number;
  gst_rate: number;
  taxable_paise: number;
  line_total_paise: number;
}

const LINE_GRID = "grid-cols-[minmax(10rem,2fr)_0.9fr_0.6fr_0.9fr_0.6fr_0.9fr_0.9fr]";

const STATUS_VARIANT: Record<string, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  placed: "success",
  cancelled: "danger",
};

export function DebitNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const [head, setHead] = useState<DnHead | null>(null);
  const [lines, setLines] = useState<DnLine[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("debit_notes")
      .select(
        "id,note_no,note_date,created_at,reason,is_interstate,taxable_paise,cgst_paise,sgst_paise,igst_paise,itc_reversal_paise,total_paise,status,notes,vendor:ledgers(name)",
      )
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (!data) {
          setNotFound(true);
          return;
        }
        setHead(data as unknown as DnHead);
      });
    supabase
      .from("debit_note_lines")
      .select("id,name,batch_no,qty,ptr_paise,gst_rate,taxable_paise,line_total_paise")
      .eq("debit_note_id", id)
      .then(({ data }) => {
        if (active) setLines((data as DnLine[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  if (notFound) {
    return (
      <Page width="lg">
        <p className="text-sm text-text-tertiary">Debit note not found.</p>
        <Link to="/purchases/returns" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to debit notes
        </Link>
      </Page>
    );
  }

  const ref = head?.note_no ?? (id ? `#${id.slice(0, 8)}` : "Debit note");

  return (
    <Page width="lg">
      <Link
        to="/purchases/returns"
        className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Debit notes
      </Link>

      <PageHeader
        icon={CornerUpLeft}
        title={head?.vendor?.name ?? "Debit note"}
        subtitle={
          head ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{ref}</span>
              <Badge variant={head.is_interstate ? "warning" : "neutral"}>{head.is_interstate ? "IGST" : "CGST+SGST"}</Badge>
              <Badge variant={STATUS_VARIANT[head.status] ?? "neutral"}>{head.status}</Badge>
              <span className="text-text-tertiary">
                {format(new Date(head.note_date ?? head.created_at), "d MMM yyyy")}
                {head.reason ? ` · ${head.reason}` : ""}
              </span>
            </span>
          ) : (
            "Loading…"
          )
        }
      />

      {head && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Taxable" value={formatPaise(head.taxable_paise)} />
          <StatCard label="ITC reversed" value={formatPaise(head.itc_reversal_paise)} />
          <StatCard label="Total" value={formatPaise(head.total_paise)} />
        </div>
      )}

      {head?.notes && <p className="mb-4 text-sm text-text-secondary">{head.notes}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[38rem]">
          <div className={`grid ${LINE_GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span>Batch</span>
            <span className="text-right">Qty</span>
            <span className="text-right">PTR</span>
            <span className="text-right">GST</span>
            <span className="text-right">Taxable</span>
            <span className="text-right">Total</span>
          </div>
          {lines === null ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">No lines on this debit note.</p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className={`grid ${LINE_GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                <span className="min-w-0 truncate" title={l.name}>{l.name}</span>
                <span className="truncate text-xs text-text-tertiary">{l.batch_no || "-"}</span>
                <span className="text-right tabular-nums">{l.qty}</span>
                <span className="text-right tabular-nums">{formatPaise(l.ptr_paise)}</span>
                <span className="text-right tabular-nums text-text-tertiary">{l.gst_rate}%</span>
                <span className="text-right tabular-nums">{formatPaise(l.taxable_paise)}</span>
                <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
              </div>
            ))
          )}
          {head && (
            <div className={`grid ${LINE_GRID} gap-2 bg-surface px-3 py-2 text-sm font-medium`}>
              <span className="col-span-5">Total</span>
              <span className="text-right tabular-nums">{formatPaise(head.taxable_paise)}</span>
              <span className="text-right tabular-nums">{formatPaise(head.total_paise)}</span>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
