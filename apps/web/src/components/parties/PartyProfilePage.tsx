import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Receipt, Save, ShoppingCart, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { partyDue, type OrderRow } from "@/lib/orders";
import { useBill } from "@/store/bill";

interface Ledger {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  gstin: string | null;
  address: string | null;
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
  order_date: string;
  created_at: string;
  payment_method: string | null;
  due_date: string | null;
  status: string;
  order_no: string | null;
}

const rupees = (paise: number) =>
  (Math.abs(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function Money({ paise, plain }: { paise: number; plain?: boolean }) {
  if (paise === 0) return <span className="text-muted-foreground">₹0</span>;
  const dr = paise > 0;
  return (
    <span className={plain ? "" : dr ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      ₹{rupees(paise)}
      {!plain && ` ${dr ? "Dr" : "Cr"}`}
    </span>
  );
}

export function PartyProfilePage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const setParty = useBill((s) => s.setParty);

  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [orders, setOrders] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    Promise.all([
      supabase
        .from("ledgers")
        .select("id,name,type,phone,gstin,address,credit_limit_paise,opening_balance_paise")
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("ledger_bills")
        .select("id,ref_no,bill_date,amount_paise,nature,due_date,days_overdue")
        .eq("ledger_id", id)
        .order("bill_date"),
      supabase
        .from("orders")
        .select("id,direction,total_paise,paid_paise,order_date,created_at,payment_method,due_date,status,order_no")
        .eq("party_id", id)
        .order("created_at", { ascending: false }),
    ]).then(([l, b, o]) => {
      if (!active) return;
      if (!l.data) {
        setNotFound(true);
      } else {
        setLedger(l.data as Ledger);
        setBills((b.data as BillRow[] | null) ?? []);
        setOrders((o.data as OrderHistoryRow[] | null) ?? []);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  const due = useMemo(
    () => (ledger ? partyDue(ledger.opening_balance_paise, orders) : 0),
    [ledger, orders],
  );

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

  if (loading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>;
  }
  if (notFound || !ledger) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Party not found.</p>
        <Link to="/parties" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          ← Back to parties
        </Link>
      </Shell>
    );
  }

  const isCustomer = ledger.type === "customer";

  return (
    <Shell>
      <Link to="/parties" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Parties
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <User className="size-6 text-primary" />
        <h1 className="text-xl font-semibold">{ledger.name}</h1>
        <Badge variant="secondary">{ledger.type}</Badge>
        <span className="flex-1" />
        {isCustomer ? (
          <Button onClick={newSale}>
            <ShoppingCart /> New sale
          </Button>
        ) : (
          <Button onClick={() => navigate(`/parties/${ledger.id}/purchase`)}>
            <ShoppingCart /> New purchase
          </Button>
        )}
      </div>

      {/* Due summary */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Amount due">
          <span className={due >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            <Money paise={due} />
          </span>
        </Stat>
        <Stat label="Opening balance"><Money paise={ledger.opening_balance_paise} /></Stat>
        <Stat label="Open bills"><span className="tabular-nums">{bills.length}</span></Stat>
        <Stat label="Orders"><span className="tabular-nums">{orders.length}</span></Stat>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Due = opening balance + unsettled orders. <Money paise={due} plain /> {due >= 0 ? "receivable (they owe you)" : "payable (you owe them)"}.
      </p>

      {/* Details */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="text-sm font-medium">Details</h2>
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

      {/* Order history */}
      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Receipt className="size-4 text-muted-foreground" /> Order history
        </h2>
        <div className="mt-2 overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_0.8fr_0.9fr_0.9fr_0.8fr] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Date</span>
            <span>Type</span>
            <span className="text-right">Total</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Status</span>
          </div>
          {orders.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No orders yet. {isCustomer && "Use New sale to bill this customer."}
            </p>
          ) : (
            orders.map((o) => (
              <div key={o.id} className="grid grid-cols-[1fr_0.8fr_0.9fr_0.9fr_0.8fr] items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
                <span className="text-muted-foreground">{format(new Date(o.created_at), "d MMM yyyy")}</span>
                <span><Badge variant="secondary">{o.direction}</Badge></span>
                <span className="text-right tabular-nums">{formatPaise(o.total_paise)}</span>
                <span className="text-right tabular-nums text-muted-foreground">{formatPaise(o.paid_paise)}</span>
                <span className="text-right text-xs text-muted-foreground">
                  {o.paid_paise >= o.total_paise ? "paid" : o.due_date ? `due ${format(new Date(o.due_date), "d MMM")}` : "due"}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Open bills from import */}
      {bills.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Open bills <span className="text-xs font-normal text-muted-foreground">(from import — breakdown of opening balance)</span></h2>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border">
            <div className="grid grid-cols-[1fr_0.9fr_0.9fr_0.7fr] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Ref</span>
              <span>Date</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Days</span>
            </div>
            {bills.map((b) => (
              <div key={b.id} className="grid grid-cols-[1fr_0.9fr_0.9fr_0.7fr] items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
                <span className="min-w-0 truncate font-mono text-xs">{b.ref_no || "—"}</span>
                <span className="text-muted-foreground">{b.bill_date ? format(new Date(b.bill_date), "d MMM yyyy") : "—"}</span>
                <span className="text-right tabular-nums">
                  {formatPaise(b.amount_paise)} <span className="text-xs text-muted-foreground">{b.nature?.toUpperCase()}</span>
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">{b.days_overdue ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Party</span>
        </div>
        <UserMenu />
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">{children}</main>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-base font-semibold tabular-nums">{children}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
