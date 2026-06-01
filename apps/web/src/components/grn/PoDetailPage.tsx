import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, ClipboardList, Send, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { SendPoDialog } from "./SendPoDialog";

interface PoHead {
  id: string;
  po_no: string | null;
  po_date: string | null;
  created_at: string;
  expected_date: string | null;
  total_paise: number;
  status: string;
  notes: string | null;
  vendor_id: string | null;
  vendor: { name: string; phone: string | null } | null;
}

interface PoLineRow {
  id: string;
  name: string;
  qty: number;
  ptr_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const LINE_GRID = "grid-cols-[minmax(10rem,2fr)_0.6fr_0.9fr_0.6fr_0.9fr]";

const STATUS_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  sent: "info",
  partial: "warning",
  received: "success",
  closed: "neutral",
  cancelled: "danger",
};

export function PoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const shopName = useAuth().shop?.name ?? null;
  const navigate = useNavigate();
  const [head, setHead] = useState<PoHead | null>(null);
  const [lines, setLines] = useState<PoLineRow[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("purchase_orders")
      .select("id,po_no,po_date,created_at,expected_date,total_paise,status,notes,vendor_id,vendor:ledgers(name,phone)")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        if (!data) {
          setNotFound(true);
          return;
        }
        setHead(data as unknown as PoHead);
      });
    supabase
      .from("po_lines")
      .select("id,name,qty,ptr_paise,gst_rate,line_total_paise")
      .eq("po_id", id)
      .then(({ data }) => {
        if (active) setLines((data as PoLineRow[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  if (notFound) {
    return (
      <Page width="lg">
        <p className="text-sm text-text-tertiary">Purchase order not found.</p>
        <Link to="/purchases/orders" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to purchase orders
        </Link>
      </Page>
    );
  }

  const ref = head?.po_no ?? (id ? `#${id.slice(0, 8)}` : "PO");
  const canReceive = head ? !["received", "closed", "cancelled"].includes(head.status) : false;
  const canSend = head ? !["received", "closed", "cancelled"].includes(head.status) : false;

  // Flip draft → sent after a WhatsApp/email send (idempotent; only from draft).
  async function markSent() {
    if (!supabase || !head || head.status !== "draft") return;
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: "sent" })
      .eq("id", head.id)
      .eq("org_id", orgId!);
    if (!error) setHead((h) => (h ? { ...h, status: "sent" } : h));
  }

  return (
    <Page width="lg">
      <Link
        to="/purchases/orders"
        className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Purchase orders
      </Link>

      <PageHeader
        icon={ClipboardList}
        title={head?.vendor?.name ?? "Purchase order"}
        subtitle={
          head ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{ref}</span>
              <Badge variant={STATUS_VARIANT[head.status] ?? "neutral"}>{head.status}</Badge>
              <span className="text-text-tertiary">
                raised {format(new Date(head.po_date ?? head.created_at), "d MMM yyyy")}
                {head.expected_date ? ` · expected ${format(new Date(head.expected_date), "d MMM yyyy")}` : ""}
              </span>
            </span>
          ) : (
            "Loading…"
          )
        }
        actions={
          head ? (
            <>
              {canSend && (
                <Button variant="outline" onClick={() => setSendOpen(true)}>
                  <Send /> Send to vendor
                </Button>
              )}
              {canReceive && (
                <Button onClick={() => navigate(`/purchases/new?po=${head.id}`)}>
                  <Truck /> Receive against this PO
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {head && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Order value" value={formatPaise(head.total_paise)} hint="tax-exclusive" />
          <StatCard label="Lines" value={lines?.length ?? "…"} />
          <StatCard label="Status" value={head.status} />
        </div>
      )}

      {head?.notes && <p className="mb-4 text-sm text-text-secondary">{head.notes}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[34rem]">
          <div className={`grid ${LINE_GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">PTR</span>
            <span className="text-right">GST</span>
            <span className="text-right">Total</span>
          </div>
          {lines === null ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">No lines on this order.</p>
          ) : (
            lines.map((l) => (
              <div key={l.id} className={`grid ${LINE_GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                <span className="min-w-0 truncate" title={l.name}>{l.name}</span>
                <span className="text-right tabular-nums">{l.qty}</span>
                <span className="text-right tabular-nums">{formatPaise(l.ptr_paise)}</span>
                <span className="text-right tabular-nums text-text-tertiary">{l.gst_rate}%</span>
                <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
              </div>
            ))
          )}
          {head && (
            <div className={`grid ${LINE_GRID} gap-2 bg-surface px-3 py-2 text-sm font-medium`}>
              <span className="col-span-4">Order value</span>
              <span className="text-right tabular-nums">{formatPaise(head.total_paise)}</span>
            </div>
          )}
        </div>
      </div>

      {head && lines && (
        <SendPoDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          shopName={shopName}
          vendorName={head.vendor?.name ?? "Vendor"}
          vendorPhone={head.vendor?.phone ?? null}
          poRef={ref}
          date={format(new Date(head.po_date ?? head.created_at), "d MMM yyyy")}
          expectedDate={head.expected_date ? format(new Date(head.expected_date), "d MMM yyyy") : null}
          lines={lines.map((l) => ({ name: l.name, qty: l.qty, ptrPaise: l.ptr_paise }))}
          totalPaise={head.total_paise}
          onSent={markSent}
        />
      )}
    </Page>
  );
}
