import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Printer, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dot } from "@/components/ui/dot";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { buildSavedInvoicePrintData, printSavedBill } from "@/lib/billPrint";
import type { CustomerDetail } from "@/lib/printInvoice";

interface BillRow {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  created_at: string;
  total_paise: number;
  paid_paise: number;
  payment_method: string | null;
  credit_days: number | null;
  due_date: string | null;
  status: string;
  party_id: string | null;
  posts_effects: boolean | null;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  ledgers: { name: string } | null;
}

interface LineRow {
  id: string;
  name: string;
  pack: string | null;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  rate_paise: number;
  mrp_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const invoiceNo = (b: BillRow) => b.invoice_no ?? `#${b.id.slice(0, 8)}`;

export function BillHistoryPage() {
  const orgId = useAuth().membership?.orgId;
  const { shop } = useTenant();
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBill, setOpenBill] = useState<BillRow | null>(null);
  const [lines, setLines] = useState<LineRow[] | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [reprintErr, setReprintErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("sales_invoices")
      .select(
        "id,invoice_no,invoice_date,created_at,total_paise,paid_paise,payment_method,credit_days,due_date,status,party_id,posts_effects,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,ledgers(name)",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as BillRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  async function viewBill(b: BillRow) {
    setOpenBill(b);
    setLines(null);
    setCustomer(null);
    setReprintErr(null);
    if (!supabase) return;
    const { data } = await supabase
      .from("sale_lines")
      .select("id,name,pack,batch_no,expiry,qty,rate_paise,mrp_paise,gst_rate,line_total_paise")
      .eq("invoice_id", b.id);
    setLines((data as LineRow[] | null) ?? []);
    if (b.party_id) {
      const { data: cust } = await supabase
        .from("ledgers")
        .select("gstin,phone,state_code")
        .eq("id", b.party_id)
        .maybeSingle();
      setCustomer((cust as CustomerDetail | null) ?? null);
    }
  }

  function reprint() {
    if (!openBill || !lines || lines.length === 0 || !shop) return;
    const ok = printSavedBill(
      buildSavedInvoicePrintData({
        invoice: openBill,
        lines,
        shop,
        customerName: openBill.ledgers?.name ?? "Walk-in customer",
        customer,
      }),
    );
    setReprintErr(ok ? null : "Allow pop-ups for this site, then reprint.");
  }

  const totalSales = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);

  return (
    <>
      <Page width="md">
        <PageHeader
          icon={Receipt}
          title="Bills"
          subtitle={
            rows.length > 0
              ? `${rows.length} bills · ${formatPaise(totalSales)}`
              : "Every saved sale, newest first"
          }
        />

        <DataTable<BillRow>
          rows={rows}
          rowKey={(b) => b.id}
          cols="1fr 1.4fr 0.8fr 0.9fr 0.9fr"
          onRowActivate={viewBill}
          loading={loading}
          empty={
            <EmptyState icon={Receipt} title="No bills yet" hint="Save a bill from the counter to see it here." />
          }
          columns={[
            {
              key: "date",
              header: "Date",
              cell: (b) => <span className="text-text-tertiary">{format(new Date(b.created_at), "d MMM, HH:mm")}</span>,
            },
            {
              key: "customer",
              header: "Customer",
              cell: (b) => (
                <>
                  {b.ledgers?.name ?? "Walk-in"}
                  <span className="ml-1.5 text-xs text-text-tertiary">{invoiceNo(b)}</span>
                  {b.posts_effects === false && (
                    <Badge variant="neutral" className="ml-1.5">
                      imported
                    </Badge>
                  )}
                </>
              ),
            },
            {
              key: "payment",
              header: "Payment",
              cell: (b) => (
                <Badge variant={b.payment_method === "credit" ? "neutral" : "secondary"}>
                  {b.payment_method ?? "—"}
                </Badge>
              ),
            },
            { key: "total", header: "Total", numeric: true, cell: (b) => formatPaise(b.total_paise) },
            {
              key: "status",
              header: "Status",
              cell: (b) => {
                const due = b.payment_method === "credit" && b.paid_paise < b.total_paise;
                return (
                  <span className="inline-flex items-center gap-1.5 text-text-tertiary">
                    <Dot variant={due ? "warning" : "success"} />
                    {due ? (b.due_date ? `due ${format(new Date(b.due_date), "d MMM")}` : "due") : "paid"}
                  </span>
                );
              },
            },
          ]}
        />
      </Page>

      <Dialog open={openBill !== null} onOpenChange={(o) => !o && setOpenBill(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {openBill ? `${openBill.ledgers?.name ?? "Walk-in"} · ${invoiceNo(openBill)}` : "Bill"}
            </DialogTitle>
          </DialogHeader>
          {lines === null ? (
            <p className="text-sm text-text-tertiary">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b border-border bg-surface px-3 py-1.5 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Total</span>
              </div>
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="min-w-0 truncate">
                    {l.name}
                    {l.batch_no && <span className="ml-1 text-xs text-text-tertiary">{l.batch_no}</span>}
                  </span>
                  <span className="text-right tabular-nums">{l.qty}</span>
                  <span className="text-right tabular-nums">{formatPaise(l.rate_paise)}</span>
                  <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
                </div>
              ))}
              {openBill && (
                <div className="flex justify-between bg-surface px-3 py-2 text-sm font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">{formatPaise(openBill.total_paise)}</span>
                </div>
              )}
            </div>
          )}
          {reprintErr && <p className="text-sm text-text-tertiary">{reprintErr}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={reprint}
              disabled={!shop || !lines || lines.length === 0}
              title={shop ? undefined : "Set up shop details to print"}
            >
              <Printer className="size-4" /> Reprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
