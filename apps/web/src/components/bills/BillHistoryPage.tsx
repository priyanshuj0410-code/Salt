import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { Mail, MessageCircle, MessageSquare, Printer, Receipt, Undo2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dot } from "@/components/ui/dot";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { MessageThread } from "@/components/messages/MessageThread";
import { ReturnDialog } from "@/components/bills/ReturnDialog";
import { buildSavedInvoicePrintData, printSavedBill } from "@/lib/billPrint";
import { buildBillShareSubject, buildBillShareText, mailtoLink, smsLink } from "@/lib/billShare";
import { normalizePhoneForWa, whatsappUrl } from "@/lib/collection";
import type { CustomerDetail } from "@/lib/printInvoice";
import {
  DATE_PRESETS,
  PAYMENT_MODE_OPTIONS,
  filterBills,
  hasActiveFilter,
  type BillFilters,
  type DatePreset,
} from "@/lib/billFilters";

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
  is_interstate: boolean | null;
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
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  rate_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const invoiceNo = (b: BillRow) => b.invoice_no ?? `#${b.id.slice(0, 8)}`;

export function BillHistoryPage() {
  const auth = useAuth();
  const orgId = auth.membership?.orgId;
  const shop = auth.shop;
  const [rows, setRows] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openBill, setOpenBill] = useState<BillRow | null>(null);
  const [lines, setLines] = useState<LineRow[] | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [reprintErr, setReprintErr] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidErr, setVoidErr] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("sales_invoices")
      .select(
        "id,invoice_no,invoice_date,created_at,total_paise,paid_paise,payment_method,credit_days,due_date,status,party_id,posts_effects,is_interstate,discount_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,ledgers(name)",
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
    setConfirmVoid(false);
    setVoidReason("");
    setVoidErr(null);
    setReturnOpen(false);
    if (!supabase) return;
    const { data } = await supabase
      .from("sale_lines")
      .select("id,name,batch_no,expiry,qty,rate_paise,gst_rate,line_total_paise")
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
    printSavedBill(
      buildSavedInvoicePrintData({
        invoice: openBill,
        lines,
        shop,
        customerName: openBill.ledgers?.name ?? "Walk-in customer",
        customer,
      }),
    );
  }

  async function doVoid() {
    if (!supabase || !openBill || !voidReason.trim()) return;
    setVoiding(true);
    setVoidErr(null);
    const { error } = await supabase.rpc("void_sales_invoice", {
      p_invoice_id: openBill.id,
      p_reason: voidReason.trim(),
    });
    setVoiding(false);
    if (error) {
      setVoidErr(error.message);
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === openBill.id ? { ...r, status: "cancelled", paid_paise: 0 } : r)));
    setOpenBill(null);
  }

  // --- SALT-030: history filters + search, synced to the URL ---
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const q = params.get("q") ?? "";
  const datePreset = (params.get("date") as DatePreset) ?? "";
  const party = params.get("party") ?? "";
  const mode = params.get("mode") ?? "";
  const filters: BillFilters = useMemo(
    () => ({ q, preset: datePreset, party, mode }),
    [q, datePreset, party, mode],
  );
  const active = hasActiveFilter(filters);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  // Customer options are derived from the loaded bills (every party that appears).
  const partyOptions = useMemo(() => {
    const byId = new Map<string, string>();
    let hasWalkin = false;
    for (const r of rows) {
      if (r.party_id) byId.set(r.party_id, r.ledgers?.name ?? "—");
      else hasWalkin = true;
    }
    const named = [...byId.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name }));
    return [
      { value: "", label: "All customers" },
      ...(hasWalkin ? [{ value: "walkin", label: "Walk-in" }] : []),
      ...named,
    ];
  }, [rows]);

  const filtered = useMemo(() => filterBills(rows, filters), [rows, filters]);
  const filteredTotal = useMemo(() => filtered.reduce((s, r) => s + r.total_paise, 0), [filtered]);

  // "/" focuses search unless already typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- SALT-029: share message + deep links, customer auto-filled as recipient ---
  const shopName = shop?.name ?? "Our store";
  const shareText = openBill
    ? buildBillShareText({
        shopName,
        ref: invoiceNo(openBill),
        dateLabel: format(new Date(openBill.created_at), "d MMM yyyy"),
        totalPaise: openBill.total_paise,
        paidPaise: openBill.paid_paise,
        dueDateLabel:
          openBill.due_date && openBill.paid_paise < openBill.total_paise
            ? format(new Date(openBill.due_date), "d MMM yyyy")
            : null,
      })
    : "";
  const waPhone = normalizePhoneForWa(customer?.phone);
  const waUrl = openBill && waPhone ? whatsappUrl(waPhone, shareText) : null;
  const smsUrl = openBill ? smsLink(customer?.phone, shareText) : undefined;
  const mailUrl = openBill
    ? mailtoLink(null, buildBillShareSubject(shopName, invoiceNo(openBill)), shareText)
    : undefined;

  return (
    <>
      <Page width="md">
        <PageHeader
          icon={Receipt}
          title="Bills"
          subtitle={
            rows.length > 0
              ? `${filtered.length} ${filtered.length === 1 ? "bill" : "bills"} · ${formatPaise(filteredTotal)}${
                  active ? ` of ${rows.length}` : ""
                }`
              : "Every saved sale, newest first"
          }
          actions={
            <Button variant="ghost" render={<Link to="/bills/credit-notes" />}>
              <Undo2 className="size-4" /> Credit notes
            </Button>
          }
        />

        {rows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setFilter("q", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("q", "");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search bill no or customer  ( / )"
              className="w-full sm:w-64"
            />
            <FilterSelect label="Date range" value={datePreset} onChange={(v) => setFilter("date", v)} options={DATE_PRESETS} />
            <FilterSelect label="Customer" value={party} onChange={(v) => setFilter("party", v)} options={partyOptions} />
            <FilterSelect label="Payment mode" value={mode} onChange={(v) => setFilter("mode", v)} options={PAYMENT_MODE_OPTIONS} />
            {active && (
              <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear
              </Button>
            )}
          </div>
        )}

        <DataTable<BillRow>
          rows={filtered}
          rowKey={(b) => b.id}
          cols="1fr 1.4fr 0.8fr 0.9fr 0.9fr"
          onRowActivate={viewBill}
          loading={loading}
          empty={
            active ? (
              <EmptyState icon={Receipt} title="No matching bills" hint="Try clearing or widening the filters." />
            ) : (
              <EmptyState icon={Receipt} title="No bills yet" hint="Save a bill from the counter to see it here." />
            )
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
                if (b.status === "cancelled") {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-text-tertiary">
                      <Dot variant="danger" /> cancelled
                    </span>
                  );
                }
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
            <DialogTitle className="flex items-center gap-2">
              <span>{openBill ? `${openBill.ledgers?.name ?? "Walk-in"} · ${invoiceNo(openBill)}` : "Bill"}</span>
              {openBill?.status === "cancelled" && <Badge variant="danger">Cancelled</Badge>}
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
          {/* Internal notes (SALT-160) — live thread shared across counters */}
          {openBill && (
            <section className="rounded-lg border border-border p-3">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
                <MessageSquare className="size-4 text-text-tertiary" /> Internal notes
              </h3>
              <MessageThread entityType="sales_invoice" entityId={openBill.id} />
            </section>
          )}
          {reprintErr && <p className="text-sm text-text-tertiary">{reprintErr}</p>}
          {confirmVoid ? (
            <div className="space-y-2">
              <p className="text-sm text-text-tertiary">
                Cancel this bill? Stock goes back and the sale is reversed in the ledger. This cannot be undone.
              </p>
              <Input
                autoFocus
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Reason (required) — e.g. wrong item, customer cancelled"
              />
              {voidErr && <p className="text-sm text-danger">{voidErr}</p>}
              <DialogFooter className="flex-wrap">
                <Button variant="ghost" onClick={() => setConfirmVoid(false)} disabled={voiding}>
                  Back
                </Button>
                <Button variant="danger" onClick={doVoid} disabled={voiding || !voidReason.trim()}>
                  {voiding ? "Cancelling…" : "Confirm cancellation"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter className="flex-wrap">
              <Button
                variant="outline"
                onClick={reprint}
                disabled={!shop || !lines || lines.length === 0}
                title={shop ? undefined : "Set up shop details to print"}
              >
                <Printer className="size-4" /> Reprint
              </Button>
              {openBill?.party_id && openBill.status !== "cancelled" && openBill.paid_paise < openBill.total_paise && (
                <Button variant="outline" render={<Link to={`/parties/${openBill.party_id}?receive=1`} />}>
                  <Wallet className="size-4" /> Record receipt
                </Button>
              )}
              {openBill && openBill.status !== "cancelled" && openBill.posts_effects !== false && (
                <Button variant="outline" onClick={() => setReturnOpen(true)}>
                  <Undo2 className="size-4" /> Return items
                </Button>
              )}
              {waUrl ? (
                <Button variant="outline" render={<a href={waUrl} target="_blank" rel="noopener noreferrer" />}>
                  <MessageCircle className="size-4" /> WhatsApp
                </Button>
              ) : (
                <Button variant="outline" disabled title="Add a phone number to the customer to share on WhatsApp">
                  <MessageCircle className="size-4" /> WhatsApp
                </Button>
              )}
              <Button variant="outline" render={<a href={smsUrl} />}>
                <MessageSquare className="size-4" /> SMS
              </Button>
              <Button variant="outline" render={<a href={mailUrl} />}>
                <Mail className="size-4" /> Email
              </Button>
              {openBill && openBill.status !== "cancelled" && openBill.posts_effects !== false && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setVoidErr(null);
                    setConfirmVoid(true);
                  }}
                >
                  Cancel bill
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {openBill && (
        <ReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          invoiceId={openBill.id}
          invoiceNo={invoiceNo(openBill)}
          shopId={auth.shopId ?? null}
          partyId={openBill.party_id}
          isInterstate={openBill.is_interstate === true}
          defaultRefundMode={openBill.payment_method === "credit" ? "credit" : "cash"}
          onDone={() => {
            // The return restocks + posts; mark the source bill so the UI reflects it.
            // (A bill can be partially returned, so we do not auto-cancel — just refresh.)
            setOpenBill(null);
          }}
        />
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground focus-visible:border-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
