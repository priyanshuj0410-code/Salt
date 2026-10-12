import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Banknote, CalendarClock, CornerUpLeft, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { ActionBar } from "@/components/patterns/action-bar";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { isInterstate } from "@/lib/grn";
import { withTimeout, TimeoutError } from "@/lib/orders";
import { recomputeReturn, recomputeReturnNote, returnableQty, type ReturnBasis } from "@/lib/returns";

const SETTLE_MODES = [
  { value: "credit", label: "Reduce payable", icon: CalendarClock },
  { value: "cash", label: "Cash refund", icon: Banknote },
  { value: "bank", label: "Bank refund", icon: Landmark },
] as const;

/** Return line grid: Item · Batch · Received · Returnable · Return qty · Net · ITC */
const GRID = "grid-cols-[minmax(9rem,1.8fr)_0.8fr_0.7fr_0.8fr_0.7fr_0.9fr_0.9fr]";

/** A returnable line: the originating purchase line + its effective-cost basis + qty being returned. */
interface ReturnLine {
  purchaseLineId: string;
  itemId: string | null;
  batchId: string | null;
  name: string;
  batchNo: string;
  basis: ReturnBasis; // receivedQty, taxablePaise (stored), gstRate, returnedQty (prior)
  ptrPaise: number; // for display only
  returnQty: number;
}

interface PurchaseLineRow {
  id: string;
  item_id: string | null;
  batch_id: string | null;
  name: string;
  batch_no: string | null;
  qty: number;
  free_qty: number;
  ptr_paise: number;
  gst_rate: number;
  taxable_paise: number;
}

export function DebitNoteEntryPage() {
  const [sp] = useSearchParams();
  const purchaseId = sp.get("purchase");

  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const shopState = useAuth().shop?.state_code ?? null;
  const navigate = useNavigate();

  const blockers = useShopBlockers();
  const [vendor, setVendor] = useState<{ id: string; name: string; stateCode: string | null } | null>(null);
  const [grnRef, setGrnRef] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [settleMode, setSettleMode] = useState<string>("credit");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // A purchase return is always taken against an originating GRN (?purchase=<id>):
  // that's the only place the effective-cost basis (stored taxable + free qty) and the
  // returnable balance (received − prior returns) come from. SALT-190.
  useEffect(() => {
    if (!supabase || !orgId || !purchaseId) return;
    let active = true;
    (async () => {
      const { data: head } = await supabase!
        .from("purchases")
        .select("grn_no,vendor_invoice_no,vendor_id,vendor:ledgers(name,state_code)")
        .eq("org_id", orgId)
        .eq("id", purchaseId)
        .maybeSingle();
      if (!active || !head) {
        if (active) setLoaded(true);
        return;
      }
      const h = head as unknown as {
        grn_no: string | null;
        vendor_invoice_no: string | null;
        vendor_id: string | null;
        vendor: { name: string; state_code: string | null } | { name: string; state_code: string | null }[] | null;
      };
      const v = Array.isArray(h.vendor) ? h.vendor[0] : h.vendor;
      if (h.vendor_id && v) setVendor({ id: h.vendor_id, name: v.name, stateCode: v.state_code });
      setGrnRef(h.vendor_invoice_no ?? h.grn_no ?? `#${purchaseId.slice(0, 8)}`);

      const { data: pl } = await supabase!
        .from("purchase_lines")
        .select("id,item_id,batch_id,name,batch_no,qty,free_qty,ptr_paise,gst_rate,taxable_paise")
        .eq("purchase_id", purchaseId);
      const rows = (pl as PurchaseLineRow[] | null) ?? [];

      // Prior returns per purchase line = Σ debit_note_lines.qty (across all this org's
      // debit notes) keyed by purchase_line_id — so the returnable cap is cumulative.
      const ids = rows.map((r) => r.id);
      const priorByLine = new Map<string, number>();
      if (ids.length) {
        const { data: dnl } = await supabase!
          .from("debit_note_lines")
          .select("purchase_line_id,qty")
          .in("purchase_line_id", ids);
        for (const d of (dnl as { purchase_line_id: string | null; qty: number }[] | null) ?? []) {
          if (d.purchase_line_id) priorByLine.set(d.purchase_line_id, (priorByLine.get(d.purchase_line_id) ?? 0) + (d.qty ?? 0));
        }
      }
      if (!active) return;

      setLines(
        rows.map((r) => {
          const basis: ReturnBasis = {
            // Effective-cost basis straight from the persisted line — received units
            // (paid + free) and the stored net taxable (after trade discount); no recompute.
            receivedQty: r.qty + (r.free_qty ?? 0),
            taxablePaise: r.taxable_paise,
            gstRate: r.gst_rate,
            returnedQty: priorByLine.get(r.id) ?? 0,
          };
          return {
            purchaseLineId: r.id,
            itemId: r.item_id,
            batchId: r.batch_id,
            name: r.name,
            batchNo: r.batch_no ?? "",
            basis,
            ptrPaise: r.ptr_paise,
            returnQty: 0, // default: nothing selected; user enters how many to return
          };
        }),
      );
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [orgId, purchaseId]);

  const interstate = isInterstate(vendor?.stateCode, shopState);

  // Engine results per line + document totals (effective-cost basis, cumulative rounding).
  const note = useMemo(
    () => recomputeReturnNote(lines.map((l) => ({ basis: l.basis, returnQty: l.returnQty })), interstate),
    [lines, interstate],
  );
  const totals = note.totals;
  const selectedCount = useMemo(() => lines.filter((l) => l.returnQty > 0).length, [lines]);

  function setQty(idx: number, qty: number) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, returnQty: Math.max(0, Math.floor(qty || 0)) } : l)));
  }

  async function save() {
    if (!supabase || !vendor || selectedCount === 0 || saving || !shopId || !purchaseId) return;
    if (!blockers.ready) {
      setError(null);
      setSetupOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Build payload lines from the engine: taxable_paise = the engine's netValuePaise,
      // so the server's ITC reversal matches exactly what the UI showed. Only lines with
      // a return qty > 0 are sent.
      const payloadLines = lines
        .map((l) => ({ l, r: recomputeReturn(l.basis, l.returnQty, interstate) }))
        .filter(({ r }) => r.returnQty > 0)
        .map(({ l, r }) => ({
          item_id: l.itemId,
          batch_id: l.batchId,
          purchase_line_id: l.purchaseLineId,
          name: l.name,
          batch_no: l.batchNo,
          qty: r.returnQty,
          ptr_paise: l.ptrPaise,
          gst_rate: l.basis.gstRate,
          taxable_paise: r.netValuePaise,
        }));
      const args = {
        p_shop_id: shopId,
        p_vendor_id: vendor.id,
        p_purchase_id: purchaseId,
        p_reason: reason.trim() || null,
        p_settle_mode: settleMode,
        p_lines: payloadLines,
      };
      const { data, error: err } = await withTimeout(supabase.rpc("create_debit_note", args), 15000);
      if (err) setError(err.message);
      else navigate(typeof data === "string" ? `/purchases/returns/${data}` : "/purchases/returns");
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long. It may have gone through. Check Debit notes before saving again."
          : "Could not record the debit note. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && !!vendor && selectedCount > 0 && !!shopId;

  // No ?purchase= — a return must reference a GRN. Point the user to GRN history.
  if (!purchaseId) {
    return (
      <Page width="md">
        <Link to="/purchases/returns" className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary">
          <ArrowLeft className="size-3.5" /> Debit notes
        </Link>
        <PageHeader icon={CornerUpLeft} title="Return to vendor" subtitle="A purchase return is taken against the GRN it came from." />
        <p className="text-sm text-text-secondary">
          Open the GRN you're returning from in{" "}
          <Link to="/purchases" className="font-medium text-primary hover:underline">purchase history</Link> and use{" "}
          <span className="font-medium">Return to vendor</span> there: the return is computed against that receipt's
          actual cost (after scheme free goods + trade discount).
        </p>
      </Page>
    );
  }

  return (
    <Page width="lg">
      <Link
        to={`/purchases/${purchaseId}`}
        className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
      >
        <ArrowLeft className="size-3.5" /> Back to GRN
      </Link>

      <PageHeader
        icon={CornerUpLeft}
        title="Return to vendor (debit note)"
        subtitle="Return received goods. Value + ITC reverse on the effective cost (after scheme free goods + trade discount), not the raw rate."
        actions={
          vendor ? (
            <Badge variant={interstate ? "warning" : "neutral"}>{interstate ? "IGST" : "CGST+SGST"}</Badge>
          ) : undefined
        }
      />

      {/* Vendor + GRN + meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <div className="flex h-9 items-center rounded-md border border-input bg-background px-2.5 text-sm">
            <span className="truncate">{vendor?.name ?? "…"}</span>
          </div>
        </Field>
        <Field label="Against GRN">
          <div className="flex h-9 items-center rounded-md border border-input bg-background px-2.5 text-sm text-text-secondary">
            {grnRef ?? "…"}
          </div>
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="expiry / damage / wrong item" className="h-9" />
        </Field>
      </div>

      <div className="mt-3">
        <span className="text-xs text-text-tertiary">Settle by</span>
        <div className="mt-1 flex gap-1.5">
          {SETTLE_MODES.map((m) => (
            <Button key={m.value} type="button" size="sm" variant={settleMode === m.value ? "default" : "outline"} onClick={() => setSettleMode(m.value)}>
              <m.icon /> {m.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Returnable lines */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[46rem]">
          <div className={`grid ${GRID} gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase`}>
            <span>Item</span>
            <span>Batch</span>
            <span className="text-right">Received</span>
            <span className="text-right">Returnable</span>
            <span className="text-right">Return qty</span>
            <span className="text-right">Net</span>
            <span className="text-right">ITC rev.</span>
          </div>
          {!loaded ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="px-3 py-6 text-sm text-text-tertiary">This GRN has no returnable lines.</p>
          ) : (
            lines.map((l, i) => {
              const max = returnableQty(l.basis);
              const r = recomputeReturn(l.basis, l.returnQty, interstate);
              const fullyReturned = max === 0;
              return (
                <div key={l.purchaseLineId} className={`grid ${GRID} items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0`}>
                  <div className="min-w-0">
                    <div className="truncate" title={l.name}>{l.name}</div>
                    <div className="truncate text-[0.6875rem] text-text-tertiary">
                      eff {formatPaise(r.effectiveUnitCostPaise)}/u @ {l.basis.gstRate}%
                      {l.basis.returnedQty ? ` · ${l.basis.returnedQty} returned earlier` : ""}
                    </div>
                  </div>
                  <span className="truncate text-xs text-text-tertiary">{l.batchNo || "-"}</span>
                  <span className="text-right tabular-nums text-text-tertiary">{l.basis.receivedQty}</span>
                  <span className="text-right tabular-nums">{max}</span>
                  <Input
                    type="number"
                    min={0}
                    max={max}
                    value={l.returnQty || ""}
                    disabled={fullyReturned}
                    onChange={(e) => setQty(i, Number(e.target.value))}
                    placeholder="0"
                    className="h-7 px-1 text-right text-xs tabular-nums"
                  />
                  <span className="text-right tabular-nums">{formatPaise(r.netValuePaise)}</span>
                  <span className="text-right tabular-nums text-text-tertiary">{formatPaise(r.gstPaise)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* clamp warning */}
      {note.lines.some((r) => r.clamped) && (
        <p className="mt-2 text-xs text-warning">⚠ A return qty exceeded the returnable balance and was capped.</p>
      )}

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-xs space-y-1 text-sm sm:w-auto">
          <Row label="Net value" value={formatPaise(totals.netValuePaise)} muted />
          {totals.byRate
            .filter((b) => b.gstPaise > 0)
            .map((b) => (
              <Row key={b.rate} label={`GST @ ${b.rate}% ${interstate ? "(IGST)" : "(CGST+SGST)"}`} value={formatPaise(b.gstPaise)} muted />
            ))}
          <Row label="ITC reversal" value={formatPaise(totals.gstPaise)} muted />
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

      <ActionBar
        className="mt-4"
        summary={
          <span className="text-sm">
            <span className="font-semibold tabular-nums">{formatPaise(totals.grandTotalPaise)}</span>
            <span className="text-text-tertiary">
              {selectedCount ? ` · ${selectedCount} ${selectedCount === 1 ? "line" : "lines"}` : ""}
              {totals.gstPaise > 0 ? ` · ITC −${formatPaise(totals.gstPaise)}` : ""}
            </span>
          </span>
        }
        primary={{
          children: saving ? "Saving…" : `Record debit note${selectedCount ? ` (${selectedCount})` : ""}`,
          onClick: save,
          busy: saving,
          disabled: !canSave,
          icon: <CornerUpLeft />,
        }}
        secondary={
          <Button variant="ghost" onClick={() => navigate(`/purchases/${purchaseId}`)}>
            Cancel
          </Button>
        }
      />

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
