import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Banknote, CalendarClock, CornerUpLeft, Landmark, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { searchCatalog } from "@/lib/search";
import { withTimeout, TimeoutError } from "@/lib/orders";
import { debitNoteTotals, buildDebitNoteLines, computeGrnLine, isInterstate, type DebitNoteLine } from "@/lib/grn";
import { useCatalog } from "@/store/catalog";
import type { Item } from "@/lib/types";
import { VendorPicker, type PickedVendor } from "./VendorPicker";

const toRupees = (paise: number) => (paise ? paise / 100 : 0);
const toPaise = (rupees: string | number) => Math.round((Number(rupees) || 0) * 100);
const MAX_RESULTS = 8;
const SETTLE_MODES = [
  { value: "credit", label: "Reduce payable", icon: CalendarClock },
  { value: "cash", label: "Cash refund", icon: Banknote },
  { value: "bank", label: "Bank refund", icon: Landmark },
] as const;

/** Return line grid: Item · Batch · Qty · PTR · GST% · Taxable · ✕ */
const GRID = "grid-cols-[minmax(9rem,1.8fr)_0.9fr_0.6fr_0.8fr_0.6fr_0.9fr_2rem]";

interface PurchaseLineRow {
  item_id: string | null;
  batch_id: string | null;
  name: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  ptr_paise: number;
  gst_rate: number;
}

export function DebitNoteEntryPage() {
  const [sp] = useSearchParams();
  const purchaseId = sp.get("purchase");

  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const shopState = useAuth().shop?.state_code ?? null;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);

  const blockers = useShopBlockers();
  const [vendor, setVendor] = useState<PickedVendor | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [settleMode, setSettleMode] = useState<string>("credit");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<DebitNoteLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // Return against a GRN: load its vendor + lines as the returnable set.
  useEffect(() => {
    if (!supabase || !orgId || !purchaseId) return;
    let active = true;
    (async () => {
      const { data: head } = await supabase!
        .from("purchases")
        .select("vendor_id,vendor:ledgers(name,state_code)")
        .eq("org_id", orgId)
        .eq("id", purchaseId)
        .maybeSingle();
      if (!active || !head) return;
      const h = head as unknown as {
        vendor_id: string | null;
        vendor: { name: string; state_code: string | null } | { name: string; state_code: string | null }[] | null;
      };
      const v = Array.isArray(h.vendor) ? h.vendor[0] : h.vendor;
      if (h.vendor_id && v) setVendor({ id: h.vendor_id, name: v.name, stateCode: v.state_code });

      const { data: pl } = await supabase!
        .from("purchase_lines")
        .select("item_id,batch_id,name,batch_no,expiry,qty,ptr_paise,gst_rate")
        .eq("purchase_id", purchaseId);
      if (!active) return;
      const rows = (pl as PurchaseLineRow[] | null) ?? [];
      setLines(
        rows
          .filter((r) => r.item_id)
          .map((r) => ({
            itemId: r.item_id as string,
            batchId: r.batch_id,
            name: r.name,
            batchNo: r.batch_no ?? "",
            expiry: r.expiry ?? "",
            qty: r.qty,
            ptrPaise: r.ptr_paise,
            gstRate: r.gst_rate,
          })),
      );
    })();
    return () => {
      active = false;
    };
  }, [orgId, purchaseId]);

  const interstate = isInterstate(vendor?.stateCode, shopState);
  const results = useMemo(() => (query ? searchCatalog(query, items).slice(0, MAX_RESULTS) : []), [query, items]);
  const totals = useMemo(() => debitNoteTotals(lines, interstate), [lines, interstate]);

  function addItem(item: Item) {
    const b = item.batches[0];
    setLines((ls) => [
      ...ls,
      {
        itemId: item.id,
        batchId: null,
        name: item.name,
        batchNo: b?.batchNo ?? "",
        expiry: b?.expiry ?? "",
        qty: 1,
        ptrPaise: b?.ptrPaise ?? 0,
        gstRate: item.gstRate,
      },
    ]);
    setQuery("");
  }

  function patch(idx: number, p: Partial<DebitNoteLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  }

  async function save() {
    if (!supabase || !vendor || lines.length === 0 || usingSeed || saving || !shopId) return;
    if (!blockers.ready) {
      setError(null);
      setSetupOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const args = {
        p_shop_id: shopId,
        p_vendor_id: vendor.id,
        p_purchase_id: purchaseId,
        p_reason: reason.trim() || null,
        p_settle_mode: settleMode,
        p_lines: buildDebitNoteLines(lines, interstate),
      };
      const { data, error: err } = await withTimeout(supabase.rpc("create_debit_note", args), 15000);
      if (err) setError(err.message);
      else navigate(typeof data === "string" ? `/purchases/returns/${data}` : "/purchases/returns");
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long — it may have gone through. Check Debit notes before saving again."
          : "Could not record the debit note. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && !!vendor && lines.length > 0 && !usingSeed && !!shopId;

  return (
    <Page width="lg">
      <Link
        to="/purchases/returns"
        className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Debit notes
      </Link>

      <PageHeader
        icon={CornerUpLeft}
        title="Return to vendor (debit note)"
        subtitle="Send goods back to a vendor. Stock goes down, the payable drops, and the ITC claimed at receipt is reversed."
        actions={
          <Button variant={vendor ? "outline" : "default"} onClick={() => setVendorPickerOpen(true)}>
            <CornerUpLeft /> {vendor?.name ?? "Choose vendor"}
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
            {vendor && <Badge variant={interstate ? "warning" : "neutral"}>{interstate ? "IGST" : "CGST+SGST"}</Badge>}
          </button>
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="expiry / damage / wrong item" className="h-9" />
        </Field>
        <Field label="Settle by">
          <div className="flex gap-1.5">
            {SETTLE_MODES.map((m) => (
              <Button
                key={m.value}
                type="button"
                size="sm"
                variant={settleMode === m.value ? "default" : "outline"}
                onClick={() => setSettleMode(m.value)}
              >
                <m.icon /> {m.label}
              </Button>
            ))}
          </div>
        </Field>
      </div>

      {usingSeed && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
          Demo catalogue — import or add your items before recording returns.
        </p>
      )}

      {/* Item search */}
      <div className="mt-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items to return…"
            className="pl-8"
          />
        </div>
        {query.trim() && results.length > 0 && (
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
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[44rem]">
          <div className={`grid ${GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span>Batch</span>
            <span className="text-right">Qty</span>
            <span className="text-right">PTR ₹</span>
            <span className="text-right">GST %</span>
            <span className="text-right">Taxable</span>
            <span />
          </div>
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-text-tertiary">Search above to add items being returned.</p>
          ) : (
            lines.map((l, i) => {
              const c = computeGrnLine({ qty: l.qty, ptrPaise: l.ptrPaise, gstRate: l.gstRate }, interstate);
              return (
                <div key={i} className={`grid ${GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                  <div className="min-w-0">
                    <div className="truncate" title={l.name}>{l.name}</div>
                    <div className="truncate text-[0.6875rem] text-text-tertiary">ITC reversal {formatPaise(c.gstPaise)} @ {l.gstRate}%</div>
                  </div>
                  <Input value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} placeholder="batch" className="h-7 px-2 text-xs" />
                  <Input type="number" min={1} value={l.qty} onChange={(e) => patch(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} value={toRupees(l.ptrPaise) || ""} onChange={(e) => patch(i, { ptrPaise: toPaise(e.target.value) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} value={l.gstRate || ""} onChange={(e) => patch(i, { gstRate: Math.max(0, Number(e.target.value) || 0) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <span className="text-right text-xs tabular-nums">{formatPaise(c.taxablePaise)}</span>
                  <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-text-tertiary hover:text-destructive" aria-label="Remove line">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm sm:w-auto">
          <Row label="Taxable" value={formatPaise(totals.taxablePaise)} muted />
          {totals.byRate
            .filter((b) => b.gstPaise > 0)
            .map((b) => (
              <Row key={b.rate} label={`GST @ ${b.rate}% ${interstate ? "(IGST)" : "(CGST+SGST)"}`} value={formatPaise(b.gstPaise)} muted />
            ))}
          <Row label="ITC reversal" value={formatPaise(totals.itcReversalPaise)} muted />
          <div className="flex items-center justify-between border-t border-border pt-1.5 text-base font-semibold">
            <span>Debit note total</span>
            <span className="tabular-nums">{formatPaise(totals.grandTotalPaise)}</span>
          </div>
          <p className="text-right text-[0.6875rem] text-text-tertiary">
            {settleMode === "credit" ? "Reduces vendor payable" : settleMode === "cash" ? "Cash refund from vendor" : "Bank refund from vendor"}
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="lg" onClick={save} disabled={!canSave}>
          <CornerUpLeft /> {saving ? "Saving…" : "Record debit note"}
        </Button>
        <Button variant="ghost" onClick={() => navigate("/purchases/returns")}>
          Cancel
        </Button>
      </div>

      <VendorPicker open={vendorPickerOpen} onOpenChange={setVendorPickerOpen} orgId={orgId} onSelect={setVendor} />
      <ShopSetupDialog open={setupOpen} onOpenChange={setSetupOpen} onResolved={() => void save()} />
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

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={muted ? "text-text-tertiary" : ""}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
