import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

interface BillRow {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  created_at: string;
  total_paise: number;
  paid_paise: number;
  payment_method: string | null;
  due_date: string | null;
  status: string;
  party_id: string | null;
  ledgers: { name: string } | null;
}

interface LineRow {
  id: string;
  name: string;
  batch_no: string | null;
  qty: number;
  rate_paise: number;
  line_total_paise: number;
}

const invoiceNo = (b: BillRow) => b.invoice_no ?? `#${b.id.slice(0, 8)}`;

export function BillHistoryPage() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBill, setOpenBill] = useState<BillRow | null>(null);
  const [lines, setLines] = useState<LineRow[] | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("sales_invoices")
      .select(
        "id,invoice_no,invoice_date,created_at,total_paise,paid_paise,payment_method,due_date,status,party_id,ledgers(name)",
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
    if (!supabase) return;
    const { data } = await supabase
      .from("sale_lines")
      .select("id,name,batch_no,qty,rate_paise,line_total_paise")
      .eq("invoice_id", b.id);
    setLines((data as LineRow[] | null) ?? []);
  }

  const totalSales = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Bills</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <div className="flex items-center gap-2">
          <Receipt className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">Bills</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every saved sale, newest first. {rows.length > 0 && `${rows.length} bills · ${formatPaise(totalSales)} total.`}
        </p>

        <div className="mt-5 overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_1.4fr_0.8fr_0.9fr_0.9fr] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Date</span>
            <span>Customer</span>
            <span>Payment</span>
            <span className="text-right">Total</span>
            <span className="text-right">Status</span>
          </div>
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No bills yet. Save a bill from the billing screen to see it here.
            </p>
          ) : (
            <div className="max-h-[64vh] overflow-auto">
              {rows.map((b) => (
                <button
                  key={b.id}
                  onClick={() => viewBill(b)}
                  className="grid w-full grid-cols-[1fr_1.4fr_0.8fr_0.9fr_0.9fr] items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50"
                >
                  <span className="text-muted-foreground">
                    {format(new Date(b.created_at), "d MMM, HH:mm")}
                  </span>
                  <span className="min-w-0 truncate">
                    {b.ledgers?.name ?? "Walk-in"}
                    <span className="ml-1.5 text-xs text-muted-foreground">{invoiceNo(b)}</span>
                  </span>
                  <span className="text-xs">
                    <Badge variant={b.payment_method === "credit" ? "outline" : "secondary"}>
                      {b.payment_method ?? "—"}
                    </Badge>
                  </span>
                  <span className="text-right tabular-nums">{formatPaise(b.total_paise)}</span>
                  <span className="text-right text-xs text-muted-foreground">
                    {b.payment_method === "credit" && b.paid_paise < b.total_paise
                      ? b.due_date
                        ? `due ${format(new Date(b.due_date), "d MMM")}`
                        : "due"
                      : "paid"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Link to="/owner" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to owner dashboard
        </Link>
      </main>

      <Dialog open={openBill !== null} onOpenChange={(o) => !o && setOpenBill(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {openBill ? `${openBill.ledgers?.name ?? "Walk-in"} · ${invoiceNo(openBill)}` : "Bill"}
            </DialogTitle>
          </DialogHeader>
          {lines === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Total</span>
              </div>
              {lines.map((l) => (
                <div
                  key={l.id}
                  className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="min-w-0 truncate">
                    {l.name}
                    {l.batch_no && <span className="ml-1 text-xs text-muted-foreground">{l.batch_no}</span>}
                  </span>
                  <span className="text-right tabular-nums">{l.qty}</span>
                  <span className="text-right tabular-nums">{formatPaise(l.rate_paise)}</span>
                  <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
                </div>
              ))}
              {openBill && (
                <div className="flex justify-between bg-muted/30 px-3 py-2 text-sm font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">{formatPaise(openBill.total_paise)}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
