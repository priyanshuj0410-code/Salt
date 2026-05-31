import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { supabase } from "@/lib/supabase";
import { buildSalesInvoicePayload, withTimeout, TimeoutError } from "@/lib/orders";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
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
  const setPaymentMethod = useBill((s) => s.setPaymentMethod);
  const setCreditDays = useBill((s) => s.setCreditDays);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const shopId = useAuth().shopId;
  const blockers = useShopBlockers();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const t = billTotals(lines);
  const empty = lines.length === 0;

  async function save() {
    if (!supabase || empty || usingSeed || saving || !shopId) return;
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
      const args = buildSalesInvoicePayload(shopId, party, lines, payment);
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

  useHotkeys(
    "f9",
    (e) => {
      e.preventDefault();
      void save();
    },
    { enableOnFormTags: true },
    [lines, payment, party, usingSeed, shopId, blockers.ready],
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
  };
}

export type Checkout = ReturnType<typeof useCheckout>;
