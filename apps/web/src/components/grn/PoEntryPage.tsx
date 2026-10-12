import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, PackagePlus, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { searchCatalog } from "@/lib/search";
import { withTimeout, TimeoutError } from "@/lib/orders";
import { poLineTotal, poTotal, buildPoLineRows, type PoLine } from "@/lib/grn";
import { useCatalog } from "@/store/catalog";
import type { Item } from "@/lib/types";
import { CreateItemDialog } from "./CreateItemDialog";
import { VendorPicker, type PickedVendor } from "./VendorPicker";

const toRupees = (paise: number) => (paise ? paise / 100 : 0);
const toPaise = (rupees: string | number) => Math.round((Number(rupees) || 0) * 100);
const MAX_RESULTS = 8;

/** PO line grid: Item · Qty · PTR · GST% · Total · ✕ */
const GRID = "grid-cols-[minmax(10rem,2fr)_0.6fr_0.8fr_0.6fr_0.9fr_2rem]";

export function PoEntryPage() {
  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const userId = useAuth().user?.id ?? null;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);
  const upsertItem = useCatalog((s) => s.upsertItem);

  const [vendor, setVendor] = useState<PickedVendor | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<PoLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createItemOpen, setCreateItemOpen] = useState(false);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  const results = useMemo(() => (query ? searchCatalog(query, items).slice(0, MAX_RESULTS) : []), [query, items]);
  const hasExactMatch = useMemo(
    () => results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase()),
    [results, query],
  );
  const total = useMemo(() => poTotal(lines), [lines]);

  function addItem(item: Item) {
    const b = item.batches[0];
    setLines((ls) => [
      ...ls,
      { itemId: item.id, name: item.name, qty: 1, ptrPaise: b?.ptrPaise ?? 0, gstRate: item.gstRate },
    ]);
    setQuery("");
  }

  function patch(idx: number, p: Partial<PoLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  }

  function onItemCreated(item: Item) {
    upsertItem(item);
    addItem(item);
  }

  async function save() {
    if (!supabase || !vendor || lines.length === 0 || usingSeed || saving || !shopId || !orgId) return;
    setSaving(true);
    setError(null);
    try {
      const poId = crypto.randomUUID();
      const { error: poErr } = await withTimeout(
        supabase.from("purchase_orders").insert({
          id: poId,
          org_id: orgId,
          shop_id: shopId,
          vendor_id: vendor.id,
          status: "draft",
          expected_date: expectedDate || null,
          total_paise: total,
          notes: notes.trim() || null,
          created_by: userId,
        }),
        15000,
      );
      if (poErr) {
        setError(poErr.message);
        return;
      }
      const { error: lineErr } = await withTimeout(
        supabase.from("po_lines").insert(buildPoLineRows(poId, orgId, lines)),
        15000,
      );
      if (lineErr) {
        setError(`Order saved but lines failed: ${lineErr.message}`);
        return;
      }
      navigate(`/purchases/orders/${poId}`);
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long. It may have gone through. Check Purchase orders before saving again."
          : "Could not save the purchase order. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && !!vendor && lines.length > 0 && !usingSeed && !!shopId;

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
        title="New purchase order"
        subtitle="Order goods from a vendor before they arrive. No stock moves until you receive a GRN against it."
        actions={
          <Button variant={vendor ? "outline" : "default"} onClick={() => setVendorPickerOpen(true)}>
            <ClipboardList /> {vendor?.name ?? "Choose vendor"}
          </Button>
        }
      />

      {/* Vendor + meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <button
            onClick={() => setVendorPickerOpen(true)}
            className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm hover:bg-surface"
          >
            <span className={vendor ? "truncate" : "text-text-tertiary"}>{vendor?.name ?? "Choose vendor…"}</span>
          </button>
        </Field>
        <Field label="Expected delivery">
          <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="h-9" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="-" className="h-9" />
        </Field>
      </div>

      {usingSeed && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
          Demo catalogue: import or add your items before raising a purchase order.
        </p>
      )}

      {/* Item search */}
      <div className="mt-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items to order…"
            className="pl-8"
          />
        </div>
        {query.trim() && (
          <div className="mt-1 overflow-hidden rounded-md border border-border">
            {results.map((it) => (
              <button
                key={it.id}
                onClick={() => addItem(it)}
                className="flex w-full items-center gap-2 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface"
              >
                <Plus className="size-3.5 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                <span className="shrink-0 text-xs text-text-tertiary">{it.manufacturer}</span>
              </button>
            ))}
            {!hasExactMatch && (
              <button
                onClick={() => setCreateItemOpen(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-surface"
              >
                <PackagePlus className="size-3.5" />
                Add “{query.trim()}” as a new item
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[36rem]">
          <div className={`grid ${GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">PTR ₹</span>
            <span className="text-right">GST %</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-text-tertiary">Search above to add items to order.</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`grid ${GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                <span className="min-w-0 truncate" title={l.name}>{l.name}</span>
                <Input type="number" min={1} value={l.qty} onChange={(e) => patch(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                <Input type="number" min={0} value={toRupees(l.ptrPaise) || ""} onChange={(e) => patch(i, { ptrPaise: toPaise(e.target.value) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                <Input type="number" min={0} value={l.gstRate || ""} onChange={(e) => patch(i, { gstRate: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                <span className="text-right text-xs tabular-nums">{formatPaise(poLineTotal(l))}</span>
                <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-text-tertiary hover:text-destructive" aria-label="Remove line">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer: total + save */}
      <div className="mt-4 flex flex-wrap items-end justify-end gap-4">
        <div className="text-right">
          <div className="text-xs text-text-tertiary">Order value</div>
          <div className="text-2xl font-semibold tabular-nums">{formatPaise(total)}</div>
          <div className="text-[0.6875rem] text-text-tertiary">tax-exclusive · GST settled at GRN</div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="lg" onClick={save} disabled={!canSave}>
          <ClipboardList /> {saving ? "Saving…" : "Create order"}
        </Button>
        <Button variant="ghost" onClick={() => navigate("/purchases/orders")}>
          Cancel
        </Button>
      </div>

      <VendorPicker open={vendorPickerOpen} onOpenChange={setVendorPickerOpen} orgId={orgId} onSelect={setVendor} />
      {createItemOpen && (
        <CreateItemDialog open onOpenChange={setCreateItemOpen} defaultName={query.trim()} onCreated={onItemCreated} />
      )}
    </Page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}
