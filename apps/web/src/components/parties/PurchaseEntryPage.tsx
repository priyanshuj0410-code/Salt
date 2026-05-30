import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addDays, format } from "date-fns";
import { ArrowLeft, Banknote, CalendarClock, Plus, Search, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { searchCatalog } from "@/lib/search";
import { buildPurchasePayload, withTimeout, TimeoutError, type PurchaseLine } from "@/lib/orders";
import { useCatalog } from "@/store/catalog";
import type { Payment } from "@/lib/types";

const CREDIT_PRESETS = [7, 15, 30];
const toRupees = (paise: number) => (paise ? paise / 100 : 0);
const toPaise = (rupees: string | number) => Math.round((Number(rupees) || 0) * 100);

export function PurchaseEntryPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);

  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [payment, setPayment] = useState<Payment>({ method: "credit", creditDays: 30 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("ledgers")
      .select("id,name")
      .eq("org_id", orgId)
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setVendor((data as { id: string; name: string } | null) ?? null);
      });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  const results = useMemo(() => (query ? searchCatalog(query, items).slice(0, 8) : []), [query, items]);
  const total = useMemo(() => lines.reduce((s, l) => s + l.ptrPaise * l.qty, 0), [lines]);

  function addItem(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const b = item.batches[0];
    setLines((ls) => [
      ...ls,
      {
        itemId: item.id,
        name: item.name,
        batchNo: "",
        expiry: "",
        qty: 1,
        ptrPaise: b?.ptrPaise ?? 0,
        mrpPaise: b?.mrpPaise ?? 0,
        gstRate: item.gstRate,
      },
    ]);
    setQuery("");
  }

  function patch(idx: number, p: Partial<PurchaseLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  }

  async function save() {
    if (!supabase || !vendor || lines.length === 0 || usingSeed || saving) return; // re-entry guard
    setSaving(true);
    setError(null);
    try {
      const args = buildPurchasePayload({ id: vendor.id, name: vendor.name }, lines, payment);
      const { error: err } = await withTimeout(supabase.rpc("place_order", args), 15000);
      if (err) setError(err.message);
      else navigate(`/parties/${vendor.id}`);
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long — it may have gone through. Check the vendor's orders before saving again."
          : "Could not record the purchase. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">New purchase</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <Link
          to={vendor ? `/parties/${vendor.id}` : "/parties"}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {vendor?.name ?? "Parties"}
        </Link>

        <div className="mt-2 flex items-center gap-2">
          <Truck className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">New purchase {vendor && <span className="text-muted-foreground">from {vendor.name}</span>}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Goods received from this vendor. Each line adds stock to its batch and increases what you owe them.
        </p>

        {usingSeed && (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
            Demo catalogue — import your items before recording purchases.
          </p>
        )}

        {/* Item search */}
        <div className="mt-5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items to add…"
              className="pl-8"
            />
          </div>
          {results.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-md border">
              {results.map((it) => (
                <button
                  key={it.id}
                  onClick={() => addItem(it.id)}
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{it.manufacturer}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lines */}
        <div className="mt-4 overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1.6fr_0.9fr_0.8fr_0.5fr_0.8fr_0.8fr_0.8fr_2rem] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Item</span>
            <span>Batch</span>
            <span>Expiry</span>
            <span className="text-right">Qty</span>
            <span className="text-right">PTR ₹</span>
            <span className="text-right">MRP ₹</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Search above to add items received.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.6fr_0.9fr_0.8fr_0.5fr_0.8fr_0.8fr_0.8fr_2rem] items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
                <span className="min-w-0 truncate" title={l.name}>{l.name}</span>
                <Input value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} placeholder="batch" className="h-7 px-2 text-xs" />
                <Input value={l.expiry} onChange={(e) => patch(i, { expiry: e.target.value })} placeholder="YYYY-MM" className="h-7 px-2 text-xs" />
                <Input type="number" min={1} value={l.qty} onChange={(e) => patch(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                <Input type="number" min={0} value={toRupees(l.ptrPaise) || ""} onChange={(e) => patch(i, { ptrPaise: toPaise(e.target.value) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                <Input type="number" min={0} value={toRupees(l.mrpPaise) || ""} onChange={(e) => patch(i, { mrpPaise: toPaise(e.target.value) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                <span className="text-right text-xs tabular-nums">{formatPaise(l.ptrPaise * l.qty)}</span>
                <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive" aria-label="Remove line">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer: payment + total + save */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Payment to vendor</p>
            <div className="flex items-center gap-2">
              <Button variant={payment.method === "cash" ? "default" : "outline"} size="sm" onClick={() => setPayment((p) => ({ ...p, method: "cash" }))}>
                <Banknote /> Paid now
              </Button>
              <Button variant={payment.method === "credit" ? "default" : "outline"} size="sm" onClick={() => setPayment((p) => ({ ...p, method: "credit" }))}>
                <CalendarClock /> On credit
              </Button>
            </div>
            {payment.method === "credit" && (
              <div className="mt-2 flex items-center gap-1.5">
                {CREDIT_PRESETS.map((d) => (
                  <Button key={d} size="sm" variant={payment.creditDays === d ? "secondary" : "outline"} onClick={() => setPayment((p) => ({ ...p, creditDays: d }))}>
                    {d}d
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  due {format(addDays(new Date(), payment.creditDays), "d MMM yyyy")}
                </span>
              </div>
            )}
          </div>

          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total payable</div>
            <div className="text-2xl font-semibold tabular-nums">{formatPaise(total)}</div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button size="lg" onClick={save} disabled={saving || lines.length === 0 || usingSeed || !vendor}>
            <Truck /> {saving ? "Saving…" : "Record purchase"}
          </Button>
          <Button variant="ghost" onClick={() => navigate(vendor ? `/parties/${vendor.id}` : "/parties")}>
            Cancel
          </Button>
        </div>
      </main>
    </div>
  );
}
