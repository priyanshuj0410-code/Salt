import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, MessageCircle, MessageSquare, Receipt, Save, ShoppingCart, User, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { INDIAN_STATE_CODES } from "@/lib/stateCodes";
import { agingFor } from "@/lib/aging";
import { normalizePhoneForWa, reminderMessage, whatsappUrl } from "@/lib/collection";
import { AgingTable } from "@/components/parties/AgingTable";
import { MessageThread } from "@/components/messages/MessageThread";
import {
  partyDue,
  paymentsAdjustment,
  buildPaymentPayload,
  withTimeout,
  TimeoutError,
  type OrderRow,
} from "@/lib/orders";
import { useBill } from "@/store/bill";

interface Ledger {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  state_code: string | null;
  credit_limit_paise: number;
  opening_balance_paise: number;
}

interface BillRow {
  id: string;
  ref_no: string | null;
  bill_date: string | null;
  amount_paise: number;
  nature: string | null;
  due_date: string | null;
  days_overdue: number | null;
}

interface OrderHistoryRow extends OrderRow {
  created_at: string;
  due_date: string | null;
  /** Imported historical doc (posts_effects=false): shown in history, excluded from dues. */
  imported: boolean;
}

interface PaymentRow {
  id: string;
  direction: "received" | "paid";
  amount_paise: number;
  mode: string;
  reference: string | null;
  created_at: string;
}

const PAY_MODES = ["cash", "upi", "bank"] as const;

const rupees = (paise: number) =>
  (Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function Money({ paise, plain }: { paise: number; plain?: boolean }) {
  if (paise === 0) return <span className="text-text-tertiary">₹0</span>;
  const dr = paise > 0;
  return (
    <span className={plain ? "" : dr ? "text-success" : "text-danger"}>
      ₹{rupees(paise)}
      {!plain && ` ${dr ? "Dr" : "Cr"}`}
    </span>
  );
}

export function PartyProfilePage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const orgName = useAuth().membership?.orgName;
  const shopId = useAuth().shopId;
  const shop = useAuth().shop;
  const navigate = useNavigate();
  const setParty = useBill((s) => s.setParty);

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [orders, setOrders] = useState<OrderHistoryRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Payment dialog
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<string>("cash");
  const [payRef, setPayRef] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    Promise.all([
      supabase
        .from("ledgers")
        .select("id,name,type,phone,gstin,address,state_code,credit_limit_paise,opening_balance_paise")
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("ledger_bills")
        .select("id,ref_no,bill_date,amount_paise,nature,due_date,days_overdue")
        .eq("ledger_id", id)
        .order("bill_date"),
      // Sales live in sales_invoices (keyed by party_id); purchases in the
      // purchases table (keyed by vendor_id). Merged for history + dues.
      supabase
        .from("sales_invoices")
        .select("id,total_paise,paid_paise,created_at,due_date,posts_effects")
        .eq("party_id", id),
      supabase
        .from("purchases")
        .select("id,total_paise,paid_paise,created_at,posts_effects")
        .eq("vendor_id", id),
      supabase
        .from("payments")
        .select("id,direction,amount_paise,mode,reference,created_at")
        .eq("party_id", id)
        .order("created_at", { ascending: false }),
    ]).then(([l, b, s, p, pay]) => {
      if (!active) return;
      if (!l.data) {
        setNotFound(true);
      } else {
        type DocRow = {
          id: string;
          total_paise: number;
          paid_paise: number;
          created_at: string;
          due_date: string | null;
          posts_effects: boolean | null;
        };
        const sales = ((s.data as DocRow[] | null) ?? []).map(
          (r): OrderHistoryRow => ({ ...r, direction: "sale", imported: r.posts_effects === false }),
        );
        const purchases = ((p.data as Omit<DocRow, "due_date">[] | null) ?? []).map(
          (r): OrderHistoryRow => ({ ...r, direction: "purchase", due_date: null, imported: r.posts_effects === false }),
        );
        setLedger(l.data as Ledger);
        setBills((b.data as BillRow[] | null) ?? []);
        setPayments((pay.data as PaymentRow[] | null) ?? []);
        setOrders(
          [...sales, ...purchases].sort((x, y) =>
            x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0,
          ),
        );
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orgId, id, reloadKey]);

  // Imported history (posts_effects=false) is already reflected in the opening
  // balance, so it is excluded from the live due — only post-cutover orders count.
  const due = useMemo(
    () =>
      ledger
        ? partyDue(ledger.opening_balance_paise, orders.filter((o) => !o.imported)) +
          paymentsAdjustment(payments)
        : 0,
    [ledger, orders, payments],
  );

  // Aging of the dated open items behind the due (imported bills + post-cutover
  // unpaid orders), split into 0-30 / 31-60 / 61-90 / 90+ bands.
  const aging = useMemo(() => agingFor(bills, orders), [bills, orders]);

  // wa.me-ready phone (null = unusable) for the collection reminder.
  const waPhone = ledger ? normalizePhoneForWa(ledger.phone) : null;

  function edit<K extends keyof Ledger>(field: K, value: Ledger[K]) {
    setLedger((l) => (l ? { ...l, [field]: value } : l));
    setDirty(true);
  }

  async function save() {
    if (!supabase || !ledger) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("ledgers")
        .update({
          name: ledger.name.trim(),
          type: ledger.type,
          phone: ledger.phone?.trim() || null,
          gstin: ledger.gstin?.trim() ? ledger.gstin.trim().toUpperCase() : null,
          address: ledger.address?.trim() || null,
          state_code: ledger.state_code || null,
          credit_limit_paise: ledger.credit_limit_paise,
        })
        .eq("id", ledger.id);
      if (err) setError(err.message);
      else setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    if (!ledger) return;
    setParty({ id: ledger.id, name: ledger.name });
    navigate("/");
  }

  function sendReminder() {
    if (!ledger || !waPhone) return;
    const msg = reminderMessage({
      partyName: ledger.name,
      duePaise: due,
      shopName: shop?.name ?? orgName,
      receivable: aging.receivable,
      vpa: shop?.upi_vpa,
    });
    window.open(whatsappUrl(waPhone, msg), "_blank", "noopener,noreferrer");
  }

  async function recordPayment() {
    if (!supabase || !ledger || !shopId || payBusy) return;
    const paise = Math.round((Number(payAmount) || 0) * 100);
    if (paise <= 0) {
      setPayError("Enter an amount greater than 0.");
      return;
    }
    setPayBusy(true);
    setPayError(null);
    try {
      const direction = ledger.type === "vendor" ? "paid" : "received";
      const args = buildPaymentPayload(shopId, ledger.id, direction, payMode, paise, payRef);
      const { error: err } = await withTimeout(supabase.rpc("record_payment", args), 15000);
      if (err) {
        setPayError(err.message);
        return;
      }
      setPayOpen(false);
      setPayAmount("");
      setPayRef("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setPayError(
        e instanceof TimeoutError
          ? "Taking too long — it may have gone through. Check before retrying."
          : "Could not record the payment. Please try again.",
      );
    } finally {
      setPayBusy(false);
    }
  }

  if (loading) {
    return <Shell><p className="text-sm text-text-tertiary">Loading…</p></Shell>;
  }
  if (notFound || !ledger) {
    return (
      <Shell>
        <p className="text-sm text-text-tertiary">Party not found.</p>
        <Link to="/parties" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to parties
        </Link>
      </Shell>
    );
  }

  const isCustomer = ledger.type === "customer";

  return (
    <Shell>
      <Link to="/parties" className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> Parties
      </Link>

      <PageHeader
        icon={User}
        title={ledger.name}
        subtitle={<Badge variant="neutral" className="capitalize">{ledger.type}</Badge>}
        actions={
          <>
            {due > 0 && (
              <Button
                variant="outline"
                disabled={!waPhone}
                title={waPhone ? "Open WhatsApp with a payment reminder" : "Add a phone number to send a reminder"}
                onClick={sendReminder}
              >
                <MessageCircle /> Send reminder
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setPayError(null);
                setPayOpen(true);
              }}
            >
              <Wallet /> {ledger.type === "vendor" ? "Make payment" : "Receive payment"}
            </Button>
            {isCustomer ? (
              <Button onClick={newSale}>
                <ShoppingCart /> New sale
              </Button>
            ) : (
              <Button onClick={() => navigate(`/purchases/new?vendor=${ledger.id}`)}>
                <ShoppingCart /> New purchase
              </Button>
            )}
          </>
        }
      />

      {/* Due summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Amount due" value={<Money paise={due} />} />
        <StatCard label="Opening balance" value={<Money paise={ledger.opening_balance_paise} />} />
        <StatCard label="Open bills" value={bills.length} />
        <StatCard label="Orders" value={orders.length} />
      </div>
      <p className="mt-1.5 text-xs text-text-tertiary">
        Due = opening balance + unsettled orders − payments. <Money paise={due} plain /> {due >= 0 ? "receivable (they owe you)" : "payable (you owe them)"}.
      </p>

      {/* Aging — open items by days overdue */}
      {(aging.receivable.total > 0 || aging.payable.total > 0) && (
        <section className="mt-6 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium text-text-primary">Aging</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">Open items by days overdue (₹).</p>
          <div className="mt-3">
            <AgingTable receivable={aging.receivable} payable={aging.payable} />
          </div>
        </section>
      )}

      {/* Details */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium text-text-primary">Details</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={ledger.name} onChange={(e) => edit("name", e.target.value)} className="h-8" />
          </Field>
          <Field label="Type">
            <select
              value={ledger.type}
              onChange={(e) => edit("type", e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
            >
              <option value="customer">customer</option>
              <option value="vendor">vendor</option>
              <option value="other">other</option>
            </select>
          </Field>
          <Field label="GSTIN">
            <Input
              value={ledger.gstin ?? ""}
              onChange={(e) => edit("gstin", e.target.value)}
              placeholder="—"
              className="h-8 font-mono text-xs uppercase"
            />
          </Field>
          <Field label="State">
            <select
              value={ledger.state_code ?? ""}
              onChange={(e) => edit("state_code", e.target.value || null)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
            >
              <option value="">—</option>
              {INDIAN_STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone">
            <Input value={ledger.phone ?? ""} onChange={(e) => edit("phone", e.target.value)} placeholder="—" className="h-8" />
          </Field>
          <Field label="Address">
            <Input value={ledger.address ?? ""} onChange={(e) => edit("address", e.target.value)} placeholder="—" className="h-8" />
          </Field>
          <Field label="Credit limit (₹)">
            <Input
              type="number"
              min={0}
              value={ledger.credit_limit_paise ? ledger.credit_limit_paise / 100 : ""}
              onChange={(e) => edit("credit_limit_paise", Math.round((Number(e.target.value) || 0) * 100))}
              placeholder="0"
              className="h-8 text-right tabular-nums"
            />
          </Field>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-3">
          <Button onClick={save} disabled={busy || !dirty}>
            <Save /> {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </section>

      {/* Internal notes (SALT-161) — live message thread, shared across counters */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
          <MessageSquare className="size-4 text-text-tertiary" /> Internal notes
        </h2>
        <MessageThread entityType="customer" entityId={ledger.id} />
      </section>

      {/* Order history */}
      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
          <Receipt className="size-4 text-text-tertiary" /> Order history
        </h2>
        <DataTable
          cols="1fr 0.8fr 0.9fr 0.9fr 0.8fr"
          rows={orders}
          rowKey={(o) => o.id}
          maxHeight="none"
          columns={[
            { key: "date", header: "Date", cell: (o) => <span className="text-text-tertiary">{format(new Date(o.created_at), "d MMM yyyy")}</span> },
            { key: "type", header: "Type", cell: (o) => <Badge variant="neutral" className="capitalize">{o.direction}</Badge> },
            { key: "total", header: "Total", numeric: true, cell: (o) => formatPaise(o.total_paise) },
            { key: "paid", header: "Paid", numeric: true, cell: (o) => <span className="text-text-tertiary">{formatPaise(o.paid_paise)}</span> },
            {
              key: "status",
              header: "Status",
              numeric: true,
              cell: (o) => (
                <span className="text-xs text-text-tertiary">
                  {o.paid_paise >= o.total_paise ? "paid" : o.due_date ? `due ${format(new Date(o.due_date), "d MMM")}` : "due"}
                </span>
              ),
            },
          ]}
          empty={
            <p className="px-3 py-6 text-sm text-text-tertiary">
              No orders yet.{isCustomer ? " Use New sale to bill this customer." : ""}
            </p>
          }
        />
      </section>

      {/* Payments */}
      {payments.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
            <Wallet className="size-4 text-text-tertiary" /> Payments
          </h2>
          <DataTable
            cols="1fr 0.7fr 1.2fr 0.9fr"
            rows={payments}
            rowKey={(p) => p.id}
            maxHeight="none"
            columns={[
              { key: "date", header: "Date", cell: (p) => <span className="text-text-tertiary">{format(new Date(p.created_at), "d MMM yyyy")}</span> },
              { key: "mode", header: "Mode", cell: (p) => <Badge variant="neutral" className="uppercase">{p.mode}</Badge> },
              { key: "ref", header: "Reference", cell: (p) => <span className="text-text-tertiary">{p.reference || "—"}</span> },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                cell: (p) => (
                  <>
                    {p.direction === "received" ? "+" : "−"}
                    {formatPaise(p.amount_paise)}
                  </>
                ),
              },
            ]}
          />
        </section>
      )}

      {/* Open bills from import */}
      {bills.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-text-primary">
            Open bills <span className="text-xs font-normal text-text-tertiary">(from import — breakdown of opening balance)</span>
          </h2>
          <DataTable
            cols="1fr 0.9fr 0.9fr 0.7fr"
            rows={bills}
            rowKey={(b) => b.id}
            maxHeight="18rem"
            columns={[
              { key: "ref", header: "Ref", cell: (b) => <span className="font-mono text-xs">{b.ref_no || "—"}</span> },
              { key: "date", header: "Date", cell: (b) => <span className="text-text-tertiary">{b.bill_date ? format(new Date(b.bill_date), "d MMM yyyy") : "—"}</span> },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                cell: (b) => (
                  <>
                    {formatPaise(b.amount_paise)} <span className="text-xs text-text-tertiary">{b.nature?.toUpperCase()}</span>
                  </>
                ),
              },
              { key: "days", header: "Days", numeric: true, cell: (b) => <span className="text-text-tertiary">{b.days_overdue ?? "—"}</span> },
            ]}
          />
        </section>
      )}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {ledger.type === "vendor" ? "Make payment" : "Receive payment"} · {ledger.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label="Amount (₹)">
              <Input
                type="number"
                min={0}
                autoFocus
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0"
                className="h-9 text-right tabular-nums"
              />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Mode</span>
              <div className="flex gap-1.5">
                {PAY_MODES.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={payMode === m ? "default" : "outline"}
                    onClick={() => setPayMode(m)}
                  >
                    {m.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
            <Field label="Reference (optional)">
              <Input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="UTR / cheque no"
                className="h-9"
              />
            </Field>
            {payError && <p className="text-sm text-destructive">{payError}</p>}
            <Button onClick={recordPayment} disabled={payBusy || !shopId}>
              <Wallet /> {payBusy ? "Recording…" : ledger.type === "vendor" ? "Record payment" : "Record receipt"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <Page width="md">{children}</Page>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}

