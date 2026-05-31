import { useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { supabase } from "@/lib/supabase";
import { buildSalesInvoicePayload, withTimeout, TimeoutError, type RxDetails } from "@/lib/orders";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { gatedLines, requiresRx } from "@/lib/billing";
import { buildInvoiceData, printInvoice, type CustomerDetail } from "@/lib/printInvoice";
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
export function useCheckout({ customer }: { customer: CustomerDetail | null }) {
  const lines = useBill((s) => s.lines);
  const clear = useBill((s) => s.clear);
  const payment = useBill((s) => s.payment);
  const party = useBill((s) => s.party);
  const rx = useBill((s) => s.rx);
  const setRx = useBill((s) => s.setRx);
  const setPaymentMethod = useBill((s) => s.setPaymentMethod);
  const setCreditDays = useBill((s) => s.setCreditDays);
  const billDiscount = useBill((s) => s.billDiscount);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const { shopId, shop } = useAuth();
  const blockers = useShopBlockers();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  // Remembered across the H1 gate / shop-setup detours so a resumed save still prints.
  const printIntent = useRef(false);
  const t = billTotals(lines, billDiscount);
  const empty = lines.length === 0;
  const needsRx = requiresRx(lines);
  // Inter-state ⇒ IGST; intra-state (incl. walk-in / no party state) ⇒ CGST+SGST.
  const isInterstate = !!(customer?.state_code && shop?.state_code && customer.state_code !== shop.state_code);

  // `rx` lives in the bill store, so `clear()` (after a save, or a manual Clear)
  // resets it — one customer's prescription never carries to the next bill.
  // `opts.rx` lets the gate dialog pass details on confirm without waiting for the
  // state update; `opts.print` sets the print intent (omitted on a resume, which
  // keeps the prior intent through the H1 gate / shop-setup detours). Returns the
  // new invoice id on success, else null.
  async function save(opts: { rx?: RxDetails; print?: boolean } = {}): Promise<string | null> {
    if (!supabase || empty || usingSeed || saving || !shopId) return null;
    if (opts.print !== undefined) printIntent.current = opts.print;
    const rxToUse = opts.rx ?? rx;
    // Schedule H1/X hard gate: no save until the prescriber + patient are recorded.
    if (needsRx && !rxToUse) {
      setError(null);
      setRxOpen(true);
      return null;
    }
    // Shop must have a state_code or create_sales_invoice hits is_interstate
    // NOT NULL — show the rescue dialog and bail; its onResolved retries.
    if (!blockers.ready) {
      setError(null);
      setSetupOpen(true);
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const args = buildSalesInvoicePayload(shopId, party, lines, payment, needsRx ? rxToUse : null, billDiscount);
      const { data, error: err } = await withTimeout(supabase.rpc("create_sales_invoice", args), 15000);
      if (err) {
        setError(err.message);
        return null;
      }
      const invoiceId = (data as string | null) ?? null;
      // Capture the receipt from live bill state BEFORE clear() wipes it.
      const receipt =
        printIntent.current && invoiceId && shop
          ? buildInvoiceData({ invoiceId, shop, party, customer, lines, payment, totals: t, billDiscount, isInterstate })
          : null;
      clear();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      printIntent.current = false;
      if (receipt) printInvoice(receipt);
      return invoiceId;
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Saving is taking too long — it may have gone through. Check Bills before saving again."
          : "Could not save the bill. Please try again.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  // Confirm from the gate dialog: keep the details, close, then save straight away
  // (passing them through so we don't race the state update; print intent persists).
  function confirmRx(details: RxDetails) {
    setRx(details);
    setRxOpen(false);
    void save({ rx: details });
  }

  useHotkeys(
    "f9",
    (e) => {
      e.preventDefault();
      void save({ print: true });
    },
    { enableOnFormTags: true },
    [lines, payment, party, usingSeed, shopId, blockers.ready, needsRx, rx, isInterstate, customer, shop, billDiscount],
  );

  return {
    t,
    empty,
    usingSeed,
    payment,
    setPaymentMethod,
    setCreditDays,
    saving,
    saved,
    error,
    shopId,
    setupOpen,
    setSetupOpen,
    isInterstate,
    saveAndPrint: () => save({ print: true }),
    saveOnly: () => save({ print: false }),
    resumeSave: () => save(),
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
