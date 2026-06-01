import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { addDays, format } from "date-fns";
import { ArrowLeft, Banknote, CalendarClock, Plus, PackagePlus, Search, Trash2, Truck } from "lucide-react";
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
import { buildReceivePurchasePayload, withTimeout, TimeoutError, type PurchaseLine } from "@/lib/orders";
import {
  computeGrnLine,
  grnTotals,
  isInterstate,
  matchGrnToPo,
  discrepancyLabel,
  activeSchemeFor,
  schemeFreeQtyFor,
  schemeMismatch,
  type MatchableLine,
  type LineDiscrepancy,
  type VendorScheme,
} from "@/lib/grn";
import { useCatalog } from "@/store/catalog";
import type { Item, Payment } from "@/lib/types";
import { CreateItemDialog } from "./CreateItemDialog";
import { VendorPicker, type PickedVendor } from "./VendorPicker";

const CREDIT_PRESETS = [7, 15, 30];
const toRupees = (paise: number) => (paise ? paise / 100 : 0);
const toPaise = (rupees: string | number) => Math.round((Number(rupees) || 0) * 100);
const MAX_RESULTS = 8;

/** GRN line grid: Item · Batch · Exp · Qty · Free · PTR · Disc% · MRP · Total · ✕ */
const GRID = "grid-cols-[minmax(9rem,1.6fr)_0.9fr_0.8fr_0.5fr_0.5fr_0.8fr_0.6fr_0.8fr_0.9fr_2rem]";

interface PoLineRow {
  item_id: string | null;
  name: string;
  qty: number;
  ptr_paise: number;
  gst_rate: number;
}

export function GrnEntryPage() {
  const { id: routeVendorId } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const vendorId = routeVendorId ?? sp.get("vendor") ?? null;
  // Receiving against a purchase order (SALT-024): ?po=<id> loads + prefills it.
  const poId = sp.get("po");

  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const shopState = useAuth().shop?.state_code ?? null;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);
  const upsertItem = useCatalog((s) => s.upsertItem);

  const blockers = useShopBlockers();
  const [vendor, setVendor] = useState<PickedVendor | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [payment, setPayment] = useState<Payment>({ method: "credit", creditDays: 30 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [createItemOpen, setCreateItemOpen] = useState(false);
  // PO being received against: the ordered lines (for matching) + a display ref.
  const [poLines, setPoLines] = useState<MatchableLine[] | null>(null);
  const [poRef, setPoRef] = useState<string | null>(null);
  // Active schemes for the chosen vendor (SALT-026) — auto-applied + flagged.
  const [schemes, setSchemes] = useState<VendorScheme[]>([]);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // Preselect the vendor when arriving from a vendor profile (?vendor= or :id).
  // Skipped when a ?po= is present — the PO loader sets the vendor itself.
  useEffect(() => {
    if (!supabase || !orgId || !vendorId || poId) return;
    let active = true;
    supabase
      .from("ledgers")
      .select("id,name,state_code")
      .eq("org_id", orgId)
      .eq("id", vendorId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const v = data as { id: string; name: string; state_code: string | null };
        setVendor({ id: v.id, name: v.name, stateCode: v.state_code });
      });
    return () => {
      active = false;
    };
  }, [orgId, vendorId, poId]);

  // Receive against a PO: load its header (→ vendor) + lines, prefill the grid.
  useEffect(() => {
    if (!supabase || !orgId || !poId) return;
    let active = true;
    (async () => {
      const { data: head } = await supabase!
        .from("purchase_orders")
        .select("id,po_no,vendor_id,vendor:ledgers(name,state_code)")
        .eq("org_id", orgId)
        .eq("id", poId)
        .maybeSingle();
      if (!active || !head) return;
      const h = head as unknown as {
        po_no: string | null;
        vendor_id: string | null;
        vendor: { name: string; state_code: string | null } | { name: string; state_code: string | null }[] | null;
      };
      const v = Array.isArray(h.vendor) ? h.vendor[0] : h.vendor;
      if (h.vendor_id && v) setVendor({ id: h.vendor_id, name: v.name, stateCode: v.state_code });
      setPoRef(h.po_no ?? `#${poId.slice(0, 8)}`);

      const { data: pol } = await supabase!
        .from("po_lines")
        .select("item_id,name,qty,ptr_paise,gst_rate")
        .eq("po_id", poId);
      if (!active) return;
      const rows = (pol as PoLineRow[] | null) ?? [];
      setPoLines(rows.map((r) => ({ itemId: r.item_id, name: r.name, qty: r.qty, ptrPaise: r.ptr_paise })));
      // Prefill the GRN lines from the PO; the user adjusts to what actually arrived.
      setLines(
        rows.map((r) => ({
          itemId: r.item_id ?? "",
          name: r.name,
          batchNo: "",
          expiry: "",
          qty: r.qty,
          freeQty: 0,
          ptrPaise: r.ptr_paise,
          mrpPaise: 0,
          gstRate: r.gst_rate,
          discountType: "pct",
          discountValue: 0,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [orgId, poId]);

  // Load the chosen vendor's active schemes — used to auto-apply + flag lines.
  useEffect(() => {
    if (!supabase || !orgId || !vendor) return;
    let active = true;
    supabase
      .from("vendor_schemes")
      .select("id,vendor_id,item_id,label,discount_type,discount_value,scheme_buy_qty,scheme_free_qty,valid_from,valid_to,active")
      .eq("org_id", orgId)
      .eq("vendor_id", vendor.id)
      .eq("active", true)
      .then(({ data, error }) => {
        if (!active) return;
        // Table ships in migration 0032; if unapplied the select errors — treat
        // as "no schemes" so the GRN screen still works (SALT-026 defensive load).
        if (error) {
          setSchemes([]);
          return;
        }
        type Row = {
          id: string; vendor_id: string; item_id: string | null; label: string | null;
          discount_type: "pct" | "flat" | null; discount_value: number;
          scheme_buy_qty: number; scheme_free_qty: number;
          valid_from: string | null; valid_to: string | null; active: boolean;
        };
        setSchemes(
          ((data as Row[] | null) ?? []).map((r) => ({
            id: r.id, vendorId: r.vendor_id, itemId: r.item_id, label: r.label,
            discountType: r.discount_type, discountValue: r.discount_value,
            schemeBuyQty: r.scheme_buy_qty, schemeFreeQty: r.scheme_free_qty,
            validFrom: r.valid_from, validTo: r.valid_to, active: r.active,
          })),
        );
      });
    return () => {
      active = false;
    };
  }, [orgId, vendor]);

  const interstate = isInterstate(vendor?.stateCode, shopState);
  const results = useMemo(() => (query ? searchCatalog(query, items).slice(0, MAX_RESULTS) : []), [query, items]);
  const hasExactMatch = useMemo(
    () => results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase()),
    [results, query],
  );
  const totals = useMemo(() => grnTotals(lines, interstate), [lines, interstate]);

  // PO match: ordered (poLines) vs received (current lines), by item.
  const match = useMemo(
    () =>
      poLines
        ? matchGrnToPo(
            lines.map((l) => ({ itemId: l.itemId || null, name: l.name, qty: l.qty, ptrPaise: l.ptrPaise })),
            poLines,
          )
        : null,
    [lines, poLines],
  );
  const flagsByItem = useMemo(() => {
    const m = new Map<string, LineDiscrepancy[]>();
    if (match) for (const d of match.discrepancies) if (d.itemId) m.set(d.itemId, [...(m.get(d.itemId) ?? []), d]);
    return m;
  }, [match]);

  // Supplier-invoice cross-check: flag if the entered invoice total ≠ computed GRN total.
  const invoiceTotalPaise = toPaise(invoiceTotal);
  const invoiceMismatch = invoiceTotal.trim() !== "" && invoiceTotalPaise !== totals.grandTotalPaise;

  function addItem(item: Item) {
    const b = item.batches[0];
    // Auto-apply the vendor's active scheme for this item (SALT-026): seed the
    // trade discount + scheme free qty (10+1 → free 1 for the default qty 1 is 0
    // until qty rises, recomputed live in the flag). onDate = invoice date or today.
    const onDate = invoiceDate || new Date().toISOString().slice(0, 10);
    const scheme = activeSchemeFor(schemes, vendor?.id ?? "", item.id, onDate);
    setLines((ls) => [
      ...ls,
      {
        itemId: item.id,
        name: item.name,
        batchNo: "",
        expiry: "",
        qty: 1,
        freeQty: scheme ? schemeFreeQtyFor(scheme, 1) : 0,
        ptrPaise: b?.ptrPaise ?? 0,
        mrpPaise: b?.mrpPaise ?? 0,
        gstRate: item.gstRate,
        discountType: scheme?.discountType ?? "pct",
        discountValue: scheme?.discountType ? scheme.discountValue : 0,
      },
    ]);
    setQuery("");
  }

  function patch(idx: number, p: Partial<PurchaseLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  }

  function onItemCreated(item: Item) {
    upsertItem(item); // make it searchable for next time
    addItem(item); // and drop it straight onto this GRN
  }

  async function save() {
    if (!supabase || !vendor || lines.length === 0 || usingSeed || saving || !shopId) return;
    // Pre-flight: the shop must have a state_code or receive_purchase trips the
    // is_interstate NOT NULL. Show the rescue dialog and bail; it retries save.
    if (!blockers.ready) {
      setError(null);
      setSetupOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const base = buildReceivePurchasePayload(shopId, { id: vendor.id, name: vendor.name }, lines, payment, interstate, {
        vendorInvoiceNo: invoiceNo,
        vendorInvoiceDate: invoiceDate,
      });
      // Link the GRN to its PO (server marks the PO received). p_po_id is a valid
      // receive_purchase arg; added here to keep the shared builder PO-agnostic.
      const args = poId ? { ...base, p_po_id: poId } : base;
      const { data, error: err } = await withTimeout(supabase.rpc("receive_purchase", args), 15000);
      if (err) setError(err.message);
      else navigate(typeof data === "string" ? `/purchases/${data}` : "/purchases");
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long — it may have gone through. Check the GRN history before saving again."
          : "Could not record the GRN. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && !!vendor && lines.length > 0 && !usingSeed && !!shopId;

  return (
    <Page width="lg">
      <Link to="/purchases" className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> Purchases
      </Link>

      <PageHeader
        icon={Truck}
        title="Receive stock (GRN)"
        subtitle="Goods received from a vendor. Each line adds stock (incl. free goods) and increases what you owe."
        actions={
          vendor ? (
            <Button variant="outline" onClick={() => setVendorPickerOpen(true)}>
              <Truck /> {vendor.name}
            </Button>
          ) : (
            <Button onClick={() => setVendorPickerOpen(true)}>
              <Truck /> Choose vendor
            </Button>
          )
        }
      />

      {/* Vendor + invoice meta */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Vendor">
          <button
            onClick={() => setVendorPickerOpen(true)}
            className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-sm hover:bg-surface"
          >
            <span className={vendor ? "truncate" : "text-text-tertiary"}>{vendor?.name ?? "Choose vendor…"}</span>
            {vendor && (
              <Badge variant={interstate ? "warning" : "neutral"}>{interstate ? "IGST" : "CGST+SGST"}</Badge>
            )}
          </button>
        </Field>
        <Field label="Vendor invoice no.">
          <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="—" className="h-9" />
        </Field>
        <Field label="Invoice date">
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-9" />
        </Field>
        <Field label="Invoice total ₹ (optional)">
          <Input
            type="number"
            min={0}
            value={invoiceTotal}
            onChange={(e) => setInvoiceTotal(e.target.value)}
            placeholder="cross-check"
            className="h-9 text-right tabular-nums"
          />
        </Field>
      </div>

      {/* PO match banner (SALT-024) */}
      {poRef && match && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-sm ${match.matched ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}
        >
          <div>
            {match.matched ? (
              <>
                Matches PO <span className="font-medium">{poRef}</span> — ordered {formatPaise(match.orderedTotalPaise)},
                received {formatPaise(match.receivedTotalPaise)}.
              </>
            ) : (
              <>
                Receiving against PO <span className="font-medium">{poRef}</span> —{" "}
                <span className="font-medium">
                  {match.discrepancies.length} discrepanc{match.discrepancies.length === 1 ? "y" : "ies"}
                </span>{" "}
                (ordered {formatPaise(match.orderedTotalPaise)} vs received {formatPaise(match.receivedTotalPaise)}).
              </>
            )}
          </div>
          {!match.matched && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {match.discrepancies.map((d, i) => (
                <li key={i}>
                  <span className="font-medium">{d.name}</span>: {discrepancyLabel(d)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {usingSeed && (
        <p className="mt-3 rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
          Demo catalogue — import or add your items before recording purchases.
        </p>
      )}

      {/* Item search */}
      <div className="mt-5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items to receive…"
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
            {/* No silent add: an unmatched item is created explicitly here. */}
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
        <div className="min-w-[52rem]">
          <div className={`grid ${GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span>Batch</span>
            <span>Expiry</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Free</span>
            <span className="text-right">PTR ₹</span>
            <span className="text-right">Disc %</span>
            <span className="text-right">MRP ₹</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-text-tertiary">Search above to add items received.</p>
          ) : (
            lines.map((l, i) => {
              const c = computeGrnLine(l, interstate);
              const flags = l.itemId ? flagsByItem.get(l.itemId) : undefined;
              // Scheme flag: does the keyed line diverge from the vendor's active scheme?
              const onDate = invoiceDate || new Date().toISOString().slice(0, 10);
              const scheme = l.itemId ? activeSchemeFor(schemes, vendor?.id ?? "", l.itemId, onDate) : null;
              const sMis = scheme ? schemeMismatch(l, scheme) : null;
              return (
                <div key={i} className={`grid ${GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" title={l.name}>{l.name}</span>
                      {flags?.map((d, k) => (
                        <Badge key={k} variant="warning" className="shrink-0">{discrepancyLabel(d)}</Badge>
                      ))}
                      {sMis && (
                        <Badge variant="warning" className="shrink-0">
                          scheme: {[sMis.freeQtyOff ? `free ${sMis.expectedFreeQty}` : "", sMis.discountOff ? `disc ${sMis.expectedDiscountValue}${scheme?.discountType === "flat" ? "₹" : "%"}` : ""].filter(Boolean).join(" · ")}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-[0.6875rem] text-text-tertiary">
                      eff {formatPaise(c.effectiveCostPaise)}/u · GST {formatPaise(c.gstPaise)} @ {l.gstRate}%
                      {l.freeQty ? ` · +${l.freeQty} free` : ""}
                    </div>
                  </div>
                  <Input value={l.batchNo} onChange={(e) => patch(i, { batchNo: e.target.value })} placeholder="batch" className="h-7 px-2 text-xs" />
                  <Input value={l.expiry} onChange={(e) => patch(i, { expiry: e.target.value })} placeholder="YYYY-MM" className="h-7 px-2 text-xs" />
                  <Input type="number" min={0} value={l.qty} onChange={(e) => patch(i, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} value={l.freeQty || ""} onChange={(e) => patch(i, { freeQty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} value={toRupees(l.ptrPaise) || ""} onChange={(e) => patch(i, { ptrPaise: toPaise(e.target.value) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} max={100} value={l.discountValue || ""} onChange={(e) => patch(i, { discountType: "pct", discountValue: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <Input type="number" min={0} value={toRupees(l.mrpPaise) || ""} onChange={(e) => patch(i, { mrpPaise: toPaise(e.target.value) })} placeholder="0" className="h-7 px-1 text-right text-xs tabular-nums" />
                  <span className="text-right text-xs tabular-nums">{formatPaise(c.lineTotalPaise)}</span>
                  <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-text-tertiary hover:text-destructive" aria-label="Remove line">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer: payment + totals */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-text-tertiary">Payment to vendor</p>
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
              <span className="text-xs text-text-tertiary">due {format(addDays(new Date(), payment.creditDays), "d MMM yyyy")}</span>
            </div>
          )}
        </div>

        {/* Totals breakup */}
        <div className="w-full max-w-xs space-y-1 text-sm sm:w-auto">
          <Row label="Subtotal" value={formatPaise(totals.subtotalPaise)} muted />
          {totals.discountPaise > 0 && <Row label="Trade discount" value={`− ${formatPaise(totals.discountPaise)}`} muted />}
          <Row label="Taxable" value={formatPaise(totals.taxablePaise)} muted />
          {totals.byRate
            .filter((b) => b.gstPaise > 0)
            .map((b) => (
              <Row key={b.rate} label={`GST @ ${b.rate}% ${interstate ? "(IGST)" : "(CGST+SGST)"}`} value={formatPaise(b.gstPaise)} muted />
            ))}
          {totals.freeQty > 0 && <Row label={`Free goods (${totals.freeQty}, zero ITC)`} value="₹0.00" muted />}
          <div className="flex items-center justify-between border-t border-border pt-1.5 text-base font-semibold">
            <span>Total payable</span>
            <span className="tabular-nums">{formatPaise(totals.grandTotalPaise)}</span>
          </div>
          <p className="text-right text-[0.6875rem] text-text-tertiary">ITC claimable {formatPaise(totals.gstPaise)}</p>
          {invoiceMismatch && (
            <p className="text-right text-[0.6875rem] text-warning">
              ⚠ Invoice total {formatPaise(invoiceTotalPaise)} ≠ computed {formatPaise(totals.grandTotalPaise)}
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button size="lg" onClick={save} disabled={!canSave}>
          <Truck /> {saving ? "Saving…" : poId ? "Receive against PO" : "Record GRN"}
        </Button>
        <Button variant="ghost" onClick={() => navigate("/purchases")}>
          Cancel
        </Button>
      </div>

      <VendorPicker open={vendorPickerOpen} onOpenChange={setVendorPickerOpen} orgId={orgId} onSelect={setVendor} />
      {/* Mounted only while open so the name prefills from the current search each time. */}
      {createItemOpen && (
        <CreateItemDialog open onOpenChange={setCreateItemOpen} defaultName={query.trim()} onCreated={onItemCreated} />
      )}
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
