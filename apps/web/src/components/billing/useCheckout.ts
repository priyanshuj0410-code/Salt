import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { supabase } from "@/lib/supabase";
import { buildSalesInvoicePayload, withTimeout, TimeoutError, type RxDetails } from "@/lib/orders";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { gatedLines, requiresRx } from "@/lib/billing";
import { billTotals, useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";

/**
 * The counter's checkout logic, shared by both presentations of the ActionBar —
 * the desktop summary pane (`BillSummary`) and the mobile sticky bar
 * (`MobileCheckout`). Owns the `F9` save, so it must be used exactly **once** per
 * screen (in `BillingScreen`); the two presentations receive its result as props.
 *
 * Save semantics (unchanged from the old BillSummary): blocks on empty / demo
 * catalogue / missing shop / re-entry; routes through the shop-setup rescue dialog
 * when the shop lacks a state_code; treats a timeout as "unknown, not failed".
 */
export function useCheckout() {
  const lines = useBill((s) => s.lines);
  const clear = useBill((s) => s.clear);
  const payment = useBill((s) => s.payment);
  const party = useBill((s) => s.party);
  const rx = useBill((s) => s.rx);
  const setRx = useBill((s) => s.setRx);
  const setPaymentMethod = useBill((s) => s.setPaymentMethod);
  const setCreditDays = useBill((s) => s.setCreditDays);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const shopId = useAuth().shopId;
  const blockers = useShopBlockers();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  const t = billTotals(lines);
  const empty = lines.length === 0;
  const needsRx = requiresRx(lines);

  // `rx` lives in the bill store, so `clear()` (after a save, or a manual Clear)
  // resets it — one customer's prescription never carries to the next bill.
  // `rxOverride` lets the gate dialog pass details on confirm without waiting for
  // the state update; F9 / button callers omit it and fall back to captured `rx`.
  async function save(rxOverride?: RxDetails) {
    if (!supabase || empty || usingSeed || saving || !shopId) return;
    const rxToUse = rxOverride ?? rx;
    // Schedule H1/X hard gate: no save until the prescriber + patient are recorded.
    if (needsRx && !rxToUse) {
      setError(null);
      setRxOpen(true);
      return;
    }
    // Shop must have a state_code or create_sales_invoice hits is_interstate
    // NOT NULL — show the rescue dialog and bail; its onResolved retries.
    if (!blockers.ready) {
      setError(null);
      setSetupOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const args = buildSalesInvoicePayload(shopId, party, lines, payment, needsRx ? rxToUse : null);
      const { error: err } = await withTimeout(supabase.rpc("create_sales_invoice", args), 15000);
      if (err) {
        setError(err.message);
        return;
      }
      clear();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long — it may have gone through. Check Bills before saving again."
          : "Could not save the bill. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  // Confirm from the gate dialog: keep the details, close, then save straight away
  // (passing them through so we don't race the state update).
  function confirmRx(details: RxDetails) {
    setRx(details);
    setRxOpen(false);
    void save(details);
  }

  useHotkeys(
    "f9",
    (e) => {
      e.preventDefault();
      void save();
    },
    { enableOnFormTags: true },
    [lines, payment, party, usingSeed, shopId, blockers.ready, needsRx, rx],
  );

  return {
    t,
    empty,
    usingSeed,
    payment,
    setPaymentMethod,
    setCreditDays,
    save,
    saving,
    saved,
    error,
    shopId,
    setupOpen,
    setSetupOpen,
    // Schedule H1/X gate
    needsRx,
    rxCaptured: rx !== null,
    rx,
    gatedLines: needsRx ? gatedLines(lines) : [],
    rxOpen,
    setRxOpen,
    confirmRx,
    openRx: () => setRxOpen(true),
  };
}

export type Checkout = ReturnType<typeof useCheckout>;
