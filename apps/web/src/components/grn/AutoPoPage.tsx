import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { formatPaise } from "@/lib/currency";
import { withTimeout, TimeoutError } from "@/lib/orders";
import { suggestReorders, poLineTotal, type ReorderItemInput, type ReorderSuggestion } from "@/lib/grn";

const WINDOWS = [30, 60, 90] as const;

interface ItemRow {
  id: string;
  name: string;
  gst_rate: number | string;
  reorder_level: number | null;
  is_active: boolean | null;
}
interface BatchRow {
  item_id: string;
  qty: number;
}
interface SaleLineRow {
  // sales_invoices is embedded only for the server-side !inner window filter; not read here.
  item_id: string | null;
  qty: number;
}
interface PurchaseVendor {
  vendor_id: string | null;
  created_at: string;
  vendor: { name: string } | { name: string }[] | null;
}
interface PurchaseLineRow {
  item_id: string | null;
  ptr_paise: number;
  // PostgREST types an embedded relation as an array; normalized on read.
  purchases: PurchaseVendor | PurchaseVendor[] | null;
}

export function AutoPoPage() {
  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const userId = useAuth().user?.id ?? null;
  const navigate = useNavigate();

  const [windowDays, setWindowDays] = useState<number>(30);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const sinceISO = new Date(Date.now() - windowDays * 86400000).toISOString();
    (async () => {
      try {
      const [items, batches, saleLines, purchaseLines] = await Promise.all([
        selectAll<ItemRow>((from, to) =>
          supabase!.from("items").select("id,name,gst_rate,reorder_level,is_active").eq("org_id", orgId).range(from, to),
        ),
        selectAll<BatchRow>((from, to) =>
          supabase!.from("batches").select("item_id,qty").eq("org_id", orgId).range(from, to),
        ),
        // Posted, non-imported sales in the window — the velocity source.
        selectAll<SaleLineRow>((from, to) =>
          supabase!
            .from("sale_lines")
            .select("item_id,qty,sales_invoices!inner(invoice_date,posts_effects,status)")
            .eq("org_id", orgId)
            .eq("sales_invoices.posts_effects", true)
            .eq("sales_invoices.status", "placed")
            .gte("sales_invoices.invoice_date", sinceISO.slice(0, 10))
            .range(from, to),
        ),
        // Purchase history → most recent vendor + PTR per item.
        selectAll<PurchaseLineRow>((from, to) =>
          supabase!
            .from("purchase_lines")
            .select("item_id,ptr_paise,purchases!inner(vendor_id,created_at,vendor:ledgers(name))")
            .eq("org_id", orgId)
            .range(from, to),
        ),
      ]);

      const stockByItem = new Map<string, number>();
      for (const b of batches) stockByItem.set(b.item_id, (stockByItem.get(b.item_id) ?? 0) + (b.qty ?? 0));

      const soldByItem = new Map<string, number>();
      for (const s of saleLines) if (s.item_id) soldByItem.set(s.item_id, (soldByItem.get(s.item_id) ?? 0) + (s.qty ?? 0));

      // Last vendor/PTR per item = the most recent purchase line for it.
      const lastByItem = new Map<string, { vendorId: string | null; vendorName: string | null; ptr: number; at: string }>();
      for (const pl of purchaseLines) {
        const pur = Array.isArray(pl.purchases) ? pl.purchases[0] : pl.purchases;
        if (!pl.item_id || !pur) continue;
        const ven = Array.isArray(pur.vendor) ? pur.vendor[0] : pur.vendor;
        const at = pur.created_at;
        const prev = lastByItem.get(pl.item_id);
        if (!prev || at > prev.at) {
          lastByItem.set(pl.item_id, {
            vendorId: pur.vendor_id,
            vendorName: ven?.name ?? null,
            ptr: pl.ptr_paise,
            at,
          });
        }
      }

      const inputs: ReorderItemInput[] = items
        .filter((i) => i.is_active !== false)
        .map((i) => {
          const last = lastByItem.get(i.id);
          return {
            itemId: i.id,
            name: i.name,
            gstRate: Number(i.gst_rate) || 0,
            reorderLevel: i.reorder_level ?? 0,
            stockQty: stockByItem.get(i.id) ?? 0,
            soldInWindow: soldByItem.get(i.id) ?? 0,
            lastVendorId: last?.vendorId ?? null,
            lastVendorName: last?.vendorName ?? null,
            lastPtrPaise: last?.ptr ?? null,
          };
        });

      const result = suggestReorders(inputs, { windowDays, targetDays: 30 });
      if (!active) return;
      setSuggestions(result);
      // Default: pick every suggestion that has a known vendor (createable now).
      setPicked(Object.fromEntries(result.filter((s) => s.lastVendorId).map((s) => [s.itemId, true])));
      setQtyOverride({});
      setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not load suggestions.");
        setSuggestions([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, windowDays]);

  const qtyFor = (s: ReorderSuggestion) => qtyOverride[s.itemId] ?? s.suggestedQty;

  const pickedList = useMemo(
    () => (suggestions ?? []).filter((s) => picked[s.itemId]),
    [suggestions, picked],
  );
  const pickedWithVendor = useMemo(() => pickedList.filter((s) => s.lastVendorId), [pickedList]);
  const vendorCount = useMemo(
    () => new Set(pickedWithVendor.map((s) => s.lastVendorId)).size,
    [pickedWithVendor],
  );

  async function createDraftPos() {
    if (!supabase || !orgId || !shopId || saving || pickedWithVendor.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Group picked rows by vendor → one draft PO each.
      const byVendor = new Map<string, ReorderSuggestion[]>();
      for (const s of pickedWithVendor) {
        const v = s.lastVendorId as string;
        byVendor.set(v, [...(byVendor.get(v) ?? []), s]);
      }
      let firstPoId: string | null = null;
      for (const [vendorId, rows] of byVendor) {
        const poId = crypto.randomUUID();
        const lineRows = rows.map((s) => {
          const qty = qtyFor(s);
          const ptr = s.lastPtrPaise ?? 0;
          return {
            id: crypto.randomUUID(),
            org_id: orgId,
            po_id: poId,
            item_id: s.itemId,
            name: s.name,
            qty,
            ptr_paise: ptr,
            gst_rate: s.gstRate,
            line_total_paise: poLineTotal({ qty, ptrPaise: ptr }),
          };
        });
        const total = lineRows.reduce((sum, r) => sum + r.line_total_paise, 0);
        const { error: poErr } = await withTimeout(
          supabase.from("purchase_orders").insert({
            id: poId,
            org_id: orgId,
            shop_id: shopId,
            vendor_id: vendorId,
            status: "draft",
            total_paise: total,
            notes: "Auto-suggested from reorder levels + sales velocity",
            created_by: userId,
          }),
          15000,
        );
        if (poErr) {
          setError(poErr.message);
          return;
        }
        const { error: lineErr } = await withTimeout(supabase.from("po_lines").insert(lineRows), 15000);
        if (lineErr) {
          setError(`Order created but lines failed: ${lineErr.message}`);
          return;
        }
        firstPoId = firstPoId ?? poId;
      }
      // One PO → open it; several → the PO list.
      navigate(byVendor.size === 1 && firstPoId ? `/purchases/orders/${firstPoId}` : "/purchases/orders");
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long. It may have gone through. Check Purchase orders before retrying."
          : "Could not create the draft orders. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const rows = suggestions ?? [];
  const noVendorCount = pickedList.length - pickedWithVendor.length;

  return (
    <Page width="lg">
      <Link
        to="/purchases/orders"
        className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Purchase orders
      </Link>

      <PageHeader
        icon={Sparkles}
        title="Reorder suggestions"
        subtitle="Items at or below their reorder level, or running out fast by sales velocity. Pick what to order: drafts are grouped into one PO per vendor."
        actions={
          <Button onClick={createDraftPos} disabled={saving || pickedWithVendor.length === 0}>
            <ClipboardList /> {saving ? "Creating…" : `Create ${vendorCount || ""} draft PO${vendorCount === 1 ? "" : "s"}`}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-text-tertiary">Velocity window</span>
        <div className="flex gap-1.5">
          {WINDOWS.map((w) => (
            <Button key={w} size="sm" variant={windowDays === w ? "default" : "outline"} onClick={() => setWindowDays(w)}>
              {w}d
            </Button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="To reorder" value={rows.length} />
        <StatCard label="Selected" value={pickedList.length} />
        <StatCard label="Draft POs" value={vendorCount} hint={noVendorCount > 0 ? `${noVendorCount} need a vendor` : undefined} />
      </div>

      {suggestions === null ? (
        <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing to reorder"
          hint="No active item is below its reorder level or running out within the target window."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[2rem_minmax(9rem,1.8fr)_0.7fr_0.7fr_0.7fr_0.7fr_0.8fr_1.2fr] gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">
              <span />
              <span>Item</span>
              <span className="text-right">Stock</span>
              <span className="text-right">Reorder</span>
              <span className="text-right">/day</span>
              <span className="text-right">Cover</span>
              <span className="text-right">Order qty</span>
              <span>Last vendor</span>
            </div>
            {rows.map((s) => {
              const checked = !!picked[s.itemId];
              return (
                <div
                  key={s.itemId}
                  className="grid grid-cols-[2rem_minmax(9rem,1.8fr)_0.7fr_0.7fr_0.7fr_0.7fr_0.8fr_1.2fr] items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!s.lastVendorId}
                    onChange={(e) => setPicked((p) => ({ ...p, [s.itemId]: e.target.checked }))}
                    aria-label={`Select ${s.name}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={s.name}>{s.name}</span>
                      <Badge variant={s.reason === "below-reorder" ? "danger" : "warning"}>
                        {s.reason === "below-reorder" ? "below reorder" : "fast-moving"}
                      </Badge>
                    </div>
                    <div className="truncate text-[0.6875rem] text-text-tertiary">{s.soldInWindow} sold in {windowDays}d</div>
                  </div>
                  <span className="text-right tabular-nums">{s.stockQty}</span>
                  <span className="text-right tabular-nums text-text-tertiary">{s.reorderLevel || "-"}</span>
                  <span className="text-right tabular-nums text-text-tertiary">{s.perDay.toFixed(1)}</span>
                  <span className="text-right tabular-nums">{s.daysOfCover === Infinity ? "-" : `${Math.round(s.daysOfCover)}d`}</span>
                  <Input
                    type="number"
                    min={1}
                    value={qtyFor(s)}
                    onChange={(e) =>
                      setQtyOverride((q) => ({ ...q, [s.itemId]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))
                    }
                    className="h-7 px-1 text-right text-xs tabular-nums"
                  />
                  <span className="min-w-0 truncate text-xs">
                    {s.lastVendorName ? (
                      <>
                        {s.lastVendorName}
                        {s.lastPtrPaise != null && <span className="ml-1 text-text-tertiary">{formatPaise(s.lastPtrPaise)}</span>}
                      </>
                    ) : (
                      <span className="text-warning">no vendor: order manually</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {noVendorCount > 0 && (
        <p className="mt-3 text-xs text-text-tertiary">
          {noVendorCount} selected item{noVendorCount === 1 ? "" : "s"} have no prior vendor and are skipped. Add them via a
          manual <Link to="/purchases/orders/new" className="text-primary hover:underline">purchase order</Link>.
        </p>
      )}
    </Page>
  );
}
