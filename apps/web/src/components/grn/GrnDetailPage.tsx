import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

interface GrnHead {
  id: string;
  grn_no: string | null;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  received_date: string | null;
  created_at: string;
  is_interstate: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  paid_paise: number;
  status: string;
  vendor: { name: string } | null;
}

interface GrnLine {
  id: string;
  name: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  free_qty: number;
  ptr_paise: number;
  mrp_paise: number;
  discount_type: string | null;
  discount_value: number;
  scheme_text: string | null;
  taxable_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const LINE_GRID = "grid-cols-[minmax(8rem,1.6fr)_0.9fr_0.5fr_0.5fr_0.8fr_0.6fr_0.9fr_0.9fr]";

export function GrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const [head, setHead] = useState<GrnHead | null>(null);
  const [lines, setLines] = useState<GrnLine[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("purchases")
      .select(
        "id,grn_no,vendor_invoice_no,vendor_invoice_date,received_date,created_at,is_interstate,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,status,vendor:ledgers(name)",
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
        setHead(data as unknown as GrnHead);
      });
    supabase
      .from("purchase_lines")
      .select(
        "id,name,batch_no,expiry,qty,free_qty,ptr_paise,mrp_paise,discount_type,discount_value,scheme_text,taxable_paise,gst_rate,line_total_paise",
      )
      .eq("purchase_id", id)
      .then(({ data }) => {
        if (active) setLines((data as GrnLine[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  if (notFound) {
    return (
      <Page width="lg">
        <p className="text-sm text-text-tertiary">GRN not found.</p>
        <Link to="/purchases" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to purchases
        </Link>
      </Page>
    );
  }

  const ref = head?.vendor_invoice_no ?? head?.grn_no ?? (id ? `#${id.slice(0, 8)}` : "GRN");
  const gst = head ? head.cgst_paise + head.sgst_paise + head.igst_paise : 0;
  const due = head ? head.paid_paise < head.total_paise : false;

  return (
    <Page width="lg">
      <Link to="/purchases" className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> Purchases
      </Link>

      <PageHeader
        icon={Truck}
        title={head?.vendor?.name ?? "GRN"}
        subtitle={
          head ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{ref}</span>
              <Badge variant={head.is_interstate ? "warning" : "neutral"}>{head.is_interstate ? "IGST" : "CGST+SGST"}</Badge>
              <Badge variant={due ? "warning" : "success"}>{due ? "payable" : "paid"}</Badge>
              <span className="text-text-tertiary">
                received {format(new Date(head.received_date ?? head.created_at), "d MMM yyyy")}
                {head.vendor_invoice_date ? ` · inv ${format(new Date(head.vendor_invoice_date), "d MMM yyyy")}` : ""}
              </span>
            </span>
          ) : (
            "Loading…"
          )
        }
      />

      {head && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Taxable" value={formatPaise(head.taxable_paise)} />
          <StatCard label="ITC claimable" value={formatPaise(gst)} />
          <StatCard label="Total" value={formatPaise(head.total_paise)} />
          <StatCard label="Paid" value={formatPaise(head.paid_paise)} />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[44rem]">
          <div className={`grid ${LINE_GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span>Batch / exp</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Free</span>
            <span className="text-right">PTR</span>
            <span className="text-right">GST</span>
            <span className="text-right">Taxable</span>
            <span className="text-right">Total</span>
          </div>
          {lines === null ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">No lines on this GRN.</p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className={`grid ${LINE_GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                <div className="min-w-0">
                  <div className="truncate" title={l.name}>{l.name}</div>
                  {(l.scheme_text || (l.discount_value ? true : false)) && (
                    <div className="truncate text-[0.6875rem] text-text-tertiary">
                      {l.scheme_text || ""}
                      {l.discount_value ? `${l.scheme_text ? " · " : ""}disc ${l.discount_value}${l.discount_type === "flat" ? "₹" : "%"}` : ""}
                    </div>
                  )}
                </div>
                <span className="truncate text-xs text-text-tertiary">
                  {l.batch_no || "—"}
                  {l.expiry ? ` · ${l.expiry}` : ""}
                </span>
                <span className="text-right tabular-nums">{l.qty}</span>
                <span className="text-right tabular-nums text-text-tertiary">{l.free_qty || "—"}</span>
                <span className="text-right tabular-nums">{formatPaise(l.ptr_paise)}</span>
                <span className="text-right tabular-nums text-text-tertiary">{l.gst_rate}%</span>
                <span className="text-right tabular-nums">{formatPaise(l.taxable_paise)}</span>
                <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
              </div>
            ))
          )}
          {head && (
            <div className={`grid ${LINE_GRID} gap-2 bg-surface px-3 py-2 text-sm font-medium`}>
              <span className="col-span-6">Total</span>
              <span className="text-right tabular-nums">{formatPaise(head.taxable_paise)}</span>
              <span className="text-right tabular-nums">{formatPaise(head.total_paise)}</span>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
