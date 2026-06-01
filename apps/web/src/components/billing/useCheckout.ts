import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { supabase } from "@/lib/supabase";
import { buildSalesInvoicePayload, withTimeout, TimeoutError, type RxDetails, type SalesInvoiceArgs } from "@/lib/orders";
import { useAuth } from "@/lib/auth";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { outbox } from "@/lib/outbox";
import { formatPaise } from "@/lib/currency";
import { gatedLines, requiresRx } from "@/lib/billing";
import { creditCheck } from "@/lib/credit";
import { requestApproval, subscribeApprovals, cancelApproval } from "@/lib/approvals";
import {
  parseDiscountLimits,
  checkDiscountLimit,
  NO_DISCOUNT_LIMITS,
  type DiscountLimits,
} from "@/lib/discountLimits";
import {
  activeTenders,
  checkTenders,
  tenderSum,
  NO_TENDERS,
  type TenderAmounts,
  type TenderMode,
} from "@/lib/tenders";
import { buildInvoiceData, printInvoice, type CustomerDetail } from "@/lib/printInvoice";
import { billTotals, useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";
import { useKeymap } from "@/store/shortcuts";

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
export function useCheckout({
  customer,
  credit,
}: {
  customer: CustomerDetail | null;
  credit: { creditLimitPaise: number; duePaise: number } | null;
}) {
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
  const loadCatalog = useCatalog((s) => s.load);
  const saveKey = useKeymap((s) => s.keymap.save); // rebindable Save & Print key (SALT-178)
  const { shopId, shop, membership } = useAuth();
  const orgId = membership?.orgId;
  const blockers = useShopBlockers();
  const online = useOnlineStatus();
  // Optimistic save (SALT-155): the online write is reconciled in the background, so there is no
  // blocking "saving" state. A definite failure / timeout is held here with its payload + receipt
  // so the cashier can Retry without re-keying — the bill is never lost, the counter never blocked.
  const [failedSave, setFailedSave] = useState<{
    args: SalesInvoiceArgs;
    receipt: ReturnType<typeof buildInvoiceData> | null;
    willPrint: boolean;
    message: string;
    retryable: boolean;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  // A bill completed locally while offline and queued to sync (SALT-205) — distinct from `saved`.
  const [savedOffline, setSavedOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  // Split-tender state (SALT-198): off by default → the single `payment.method` path.
  // When on, the bill is settled by per-mode legs that must sum to the total.
  const [splitMode, setSplitMode] = useState(false);
  const [tenderAmounts, setTenderAmounts] = useState<TenderAmounts>(NO_TENDERS);
  // Discount-approval gate (SALT-206): the org's limits (loaded once) + the in-flight or
  // resolved manager override for an over-limit discount.
  const [discountLimits, setDiscountLimits] = useState<DiscountLimits>(NO_DISCOUNT_LIMITS);
  const [approval, setApproval] = useState<
    { status: "pending" | "approved" | "rejected"; id: string; approverName: string | null; coversPaise: number } | null
  >(null);
  // Credit-limit override gate (SALT-175): a parallel approval slot, so a bill over BOTH the
  // discount cap and the customer's credit limit gets both overrides without one clobbering the
  // other. `coversPaise` = the bill total this override was granted for.
  const [creditApproval, setCreditApproval] = useState<
    { status: "pending" | "approved" | "rejected"; id: string; approverName: string | null; coversPaise: number } | null
  >(null);
  // Per-bill GST series (SALT-209): the shop's active named series + the one chosen for this
  // bill (null = the shop default). Sticky across bills.
  const [series, setSeries] = useState<{ id: string; code: string; is_default: boolean }[]>([]);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  // Remembered across the H1 gate / shop-setup detours so a resumed save still prints.
  const printIntent = useRef(false);
  // Always points at the latest `save` so the realtime approval handler can resume it.
  const saveRef = useRef<
    | ((opts?: {
        rx?: RxDetails;
        print?: boolean;
        approval?: { approverName: string | null; coversPaise: number };
        creditApproval?: { approverName: string | null; coversPaise: number };
      }) => Promise<string | null>)
    | null
  >(null);
  const t = billTotals(lines, billDiscount);
  const empty = lines.length === 0;
  // Live split check (mirrors the server guards) — drives the remainder readout + Save gate.
  const tenderChk = checkTenders(tenderAmounts, t.grand, party !== null);
  const setTenderAmount = (mode: TenderMode, paise: number) =>
    setTenderAmounts((a) => ({ ...a, [mode]: Math.max(0, Math.floor(paise || 0)) }));
  // Drop the rest of the bill into one leg — the common "cash covers the remainder" tap.
  const fillRemainder = (mode: TenderMode) =>
    setTenderAmounts((a) => ({ ...a, [mode]: Math.max(0, t.grand - tenderSum({ ...a, [mode]: 0 })) }));
  const setSplit = (on: boolean) => {
    setSplitMode(on);
    if (!on) setTenderAmounts(NO_TENDERS);
  };
  // Credit-limit warning (SALT-004): advisory, non-blocking. Only for a credit sale to a
  // party with a limit set, where dues + this bill exceed it.
  const creditWarn = creditCheck(payment.method, credit?.creditLimitPaise ?? 0, credit?.duePaise ?? 0, t.grand);
  const defaultSeriesId = series.find((s) => s.is_default)?.id ?? series[0]?.id ?? null;
  const needsRx = requiresRx(lines);
  // Inter-state ⇒ IGST; intra-state (incl. walk-in / no party state) ⇒ CGST+SGST.
  const isInterstate = !!(customer?.state_code && shop?.state_code && customer.state_code !== shop.state_code);

  // Discount gate (SALT-206): total discount (line + bill) vs the org cap. `discountApproved`
  // = a manager override that covers at least the current discount.
  const discountPaise = t.discount + t.billDiscount;
  const discChk = checkDiscountLimit(discountLimits, t.gross, discountPaise);
  const discountApproved = approval?.status === "approved" && approval.coversPaise >= discountPaise;
  const creditApproved = creditApproval?.status === "approved" && creditApproval.coversPaise >= t.grand;

  // Load the org's discount policy once (cached for the session's billing screen).
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    void supabase
      .from("org_settings")
      .select("settings")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setDiscountLimits(parseDiscountLimits((data?.settings as Record<string, unknown> | null) ?? null));
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  // Register the offline sender once (SALT-205): a queued sale replays through the same RPC.
  // Throwing on error keeps the record queued for the next flush (at-least-once).
  useEffect(() => {
    outbox.register("create_sales_invoice", async (payload) => {
      if (!supabase) throw new Error("supabase unavailable");
      const { error: e } = await supabase.rpc("create_sales_invoice", payload);
      if (e) throw e;
    });
  }, []);

  // Load the shop's active sales-invoice series (SALT-209), deduped by code across FYs — the
  // RPC only needs a row of the desired code (it allocates the current-FY number from it).
  useEffect(() => {
    if (!supabase || !shopId) return;
    let active = true;
    void supabase
      .from("invoice_series")
      .select("id,code,is_default,financial_year")
      .eq("shop_id", shopId)
      .eq("doc_type", "sales_invoice")
      .eq("active", true)
      .order("financial_year", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setSeriesId(null); // a (possibly new) shop's series loaded → fall back to its default
        const byCode = new Map<string, { id: string; code: string; is_default: boolean }>();
        for (const r of (data as { id: string; code: string; is_default: boolean }[] | null) ?? []) {
          const cur = byCode.get(r.code);
          if (!cur) byCode.set(r.code, { id: r.id, code: r.code, is_default: r.is_default });
          else if (r.is_default) cur.is_default = true; // keep the latest-FY id, OR the default flag
        }
        setSeries([...byCode.values()].sort((a, b) => a.code.localeCompare(b.code)));
      });
    return () => {
      active = false;
    };
  }, [shopId]);

  // While a discount override is pending, watch the org's approvals live. On approval,
  // resume the save the cashier already asked for (override passed explicitly to dodge
  // the state-update race); on rejection, hand the bill back with a message.
  useEffect(() => {
    if (!orgId || approval?.status !== "pending") return;
    const reqId = approval.id;
    return subscribeApprovals(orgId, (r) => {
      if (r.id !== reqId) return;
      if (r.status === "approved") {
        setApproval({ status: "approved", id: r.id, approverName: r.decided_by_name, coversPaise: r.amount_paise ?? 0 });
        void saveRef.current?.({ approval: { approverName: r.decided_by_name, coversPaise: r.amount_paise ?? 0 } });
      } else if (r.status === "rejected" || r.status === "cancelled") {
        setApproval({ status: "rejected", id: r.id, approverName: r.decided_by_name, coversPaise: 0 });
        setError("Manager declined the discount. Adjust it and try again.");
      }
    });
  }, [orgId, approval?.status, approval?.id]);

  // Mirror of the discount subscription for the credit-limit override (SALT-175).
  useEffect(() => {
    if (!orgId || creditApproval?.status !== "pending") return;
    const reqId = creditApproval.id;
    return subscribeApprovals(orgId, (r) => {
      if (r.id !== reqId) return;
      if (r.status === "approved") {
        setCreditApproval({ status: "approved", id: r.id, approverName: r.decided_by_name, coversPaise: r.amount_paise ?? 0 });
        void saveRef.current?.({ creditApproval: { approverName: r.decided_by_name, coversPaise: r.amount_paise ?? 0 } });
      } else if (r.status === "rejected" || r.status === "cancelled") {
        setCreditApproval({ status: "rejected", id: r.id, approverName: r.decided_by_name, coversPaise: 0 });
        setError("Manager declined the credit override. Take payment or reduce the bill.");
      }
    });
  }, [orgId, creditApproval?.status, creditApproval?.id]);

  // `rx` lives in the bill store, so `clear()` (after a save, or a manual Clear)
  // resets it — one customer's prescription never carries to the next bill.
  // `opts.rx` lets the gate dialog pass details on confirm without waiting for the
  // state update; `opts.print` sets the print intent (omitted on a resume, which
  // keeps the prior intent through the H1 gate / shop-setup detours). Returns the
  // new invoice id on success, else null.
  async function save(
    opts: {
      rx?: RxDetails;
      print?: boolean;
      approval?: { approverName: string | null; coversPaise: number };
      creditApproval?: { approverName: string | null; coversPaise: number };
    } = {},
  ): Promise<string | null> {
    if (!supabase || empty || usingSeed || !shopId) return null;
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
    // Split-tender gate (SALT-198): the legs must sum to the total and a credit leg
    // needs a party, before we send p_tenders (the server re-validates the same).
    if (splitMode) {
      const chk = checkTenders(tenderAmounts, t.grand, party !== null);
      if (!chk.ok) {
        setError(chk.reason);
        return null;
      }
    }
    // Discount-limit gate (SALT-206): an over-cap discount needs a manager override.
    // Raise a discount_override request and bail; the live approval handler resumes
    // this save with `opts.approval` once a manager approves it.
    const override =
      opts.approval ?? (discountApproved && approval ? { approverName: approval.approverName, coversPaise: approval.coversPaise } : null);
    if (discChk.over && !(override && override.coversPaise >= discountPaise)) {
      if (orgId && approval?.status !== "pending") {
        setError(null);
        try {
          const req = await requestApproval({
            orgId,
            kind: "discount_override",
            summary: `Discount ${discChk.pct.toFixed(1)}% (${formatPaise(discountPaise)}) on a ${formatPaise(t.grand)} bill`,
            amountPaise: discountPaise,
            context: { grossPaise: t.gross, discountPaise, pct: discChk.pct, grandPaise: t.grand, party: party?.name ?? null },
          });
          if (req) setApproval({ status: "pending", id: req.id, approverName: null, coversPaise: discountPaise });
        } catch {
          setError("Could not send the approval request. Please try again.");
        }
      }
      return null; // waiting on the manager (request just raised, or still pending)
    }
    // Credit-limit gate (SALT-175): an over-limit credit sale needs a manager override too — same
    // flow as the discount gate, through the parallel credit approval slot.
    const creditOverride =
      opts.creditApproval ??
      (creditApproved && creditApproval ? { approverName: creditApproval.approverName, coversPaise: creditApproval.coversPaise } : null);
    if (creditWarn.over && !(creditOverride && creditOverride.coversPaise >= t.grand)) {
      if (orgId && creditApproval?.status !== "pending") {
        setError(null);
        try {
          const req = await requestApproval({
            orgId,
            kind: "credit_override",
            summary: `Credit sale ${formatPaise(t.grand)} over ${party?.name ?? "the customer"}'s limit`,
            amountPaise: t.grand,
            context: { grandPaise: t.grand, duePaise: credit?.duePaise ?? 0, limitPaise: credit?.creditLimitPaise ?? 0, party: party?.name ?? null },
          });
          if (req) setCreditApproval({ status: "pending", id: req.id, approverName: null, coversPaise: t.grand });
        } catch {
          setError("Could not send the approval request. Please try again.");
        }
      }
      return null;
    }
    const tenders = splitMode ? activeTenders(tenderAmounts) : null;
    const noteParts: string[] = [];
    if (override) noteParts.push(`discount by ${override.approverName ?? "manager"}`);
    if (creditOverride) noteParts.push(`credit by ${creditOverride.approverName ?? "manager"}`);
    const notes = noteParts.length ? `Manager override — ${noteParts.join("; ")}` : null;
    // Only thread a non-default series (SALT-209); the default path sends no p_series_id.
    const seriesArg = seriesId && seriesId !== defaultSeriesId ? seriesId : null;
    const args = buildSalesInvoicePayload(shopId, party, lines, payment, needsRx ? rxToUse : null, billDiscount, tenders, notes, seriesArg);

    // Offline (SALT-205): queue the write and complete the bill locally rather than block the
    // counter on a dead link. At-least-once — the outbox auto-flushes on reconnect, and the real
    // GST invoice number is allocated then (a provisional ref prints now). Read connectivity live
    // (not the render snapshot) so the decision is made at the moment of save.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const rec = await outbox.enqueue("create_sales_invoice", args);
      const receipt =
        printIntent.current && shop
          ? buildInvoiceData({ invoiceId: rec.id, shop, party, customer, lines, payment, totals: t, billDiscount, isInterstate })
          : null;
      if (receipt) receipt.ref = `OFFLINE-${rec.id.slice(0, 8).toUpperCase()}`;
      clear();
      setSplit(false);
      setApproval(null);
      setCreditApproval(null);
      setSavedOffline(true);
      setTimeout(() => setSavedOffline(false), 3000);
      printIntent.current = false;
      if (receipt) printInvoice(receipt);
      return rec.id;
    }

    // Online optimistic save (SALT-155): capture the receipt from the CURRENT bill, free the
    // counter immediately, and reconcile the RPC in the background. The receipt prints inside
    // `reconcile` AFTER the server allocates the real invoice number, so the printed bill keeps it.
    const receipt =
      printIntent.current && shop
        ? buildInvoiceData({ invoiceId: "PENDING", shop, party, customer, lines, payment, totals: t, billDiscount, isInterstate })
        : null;
    const willPrint = printIntent.current;
    clear();
    setSplit(false);
    setApproval(null);
    setCreditApproval(null);
    setFailedSave(null);
    setError(null);
    printIntent.current = false;
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    void reconcile(args, receipt, willPrint);
    return null;
  }

  // Reconcile an optimistic save against the server in the background (SALT-155). On success,
  // print the receipt with the real, server-allocated invoice number; a definite failure or a
  // timeout is held in `failedSave` (a non-blocking banner with Retry) so the bill is never lost.
  async function reconcile(
    args: SalesInvoiceArgs,
    receipt: ReturnType<typeof buildInvoiceData> | null,
    willPrint: boolean,
  ): Promise<void> {
    if (!supabase) return;
    try {
      const { data, error: err } = await withTimeout(supabase.rpc("create_sales_invoice", args), 15000);
      if (err) {
        // A returned error means the server did NOT write (atomic rollback), so a retry is safe.
        const oversell = /insufficient stock/i.test(err.message);
        if (oversell && orgId) void loadCatalog(orgId);
        setFailedSave({
          args,
          receipt,
          willPrint,
          retryable: true,
          message: oversell
            ? "Stock changed — another counter may have sold the last unit. Catalogue refreshed; retry or re-check the bill."
            : `Could not save the bill: ${err.message}`,
        });
        return;
      }
      const invoiceId = (data as string | null) ?? null;
      if (receipt && invoiceId) {
        const { data: inv } = await supabase
          .from("sales_invoices")
          .select("invoice_no")
          .eq("id", invoiceId)
          .maybeSingle();
        const invoiceNo = (inv as { invoice_no: string | null } | null)?.invoice_no;
        receipt.ref = invoiceNo ?? invoiceId.replace(/-/g, "").slice(0, 8).toUpperCase();
      }
      if (willPrint && receipt) printInvoice(receipt);
    } catch (e) {
      // Timeout: the write MAY have landed — never auto-retry (would duplicate without a server
      // idempotency key, SALT-205); the cashier checks Bills first. Hence retryable: false.
      setFailedSave({
        args,
        receipt,
        willPrint,
        retryable: false,
        message:
          e instanceof TimeoutError
            ? "Save timed out — it may have gone through. Check Bills before retrying."
            : "Could not save the bill. Check Bills, then retry if it did not go through.",
      });
    }
  }

  // Retry a held failed save (definite failures only; idempotent since the server did not write).
  function retryFailedSave() {
    if (!failedSave) return;
    const { args, receipt, willPrint } = failedSave;
    setFailedSave(null);
    void reconcile(args, receipt, willPrint);
  }
  // Keep the ref pointing at the latest `save` (assigning in render is disallowed) so the
  // realtime approval handler resumes the current closure.
  useEffect(() => {
    saveRef.current = save;
  });

  // Confirm from the gate dialog: keep the details, close, then save straight away
  // (passing them through so we don't race the state update; print intent persists).
  function confirmRx(details: RxDetails) {
    setRx(details);
    setRxOpen(false);
    void save({ rx: details });
  }

  useHotkeys(
    saveKey,
    (e) => {
      e.preventDefault();
      void save({ print: true });
    },
    { enableOnFormTags: true },
    [saveKey, lines, payment, party, usingSeed, shopId, blockers.ready, needsRx, rx, isInterstate, customer, shop, billDiscount, splitMode, tenderAmounts, discountLimits, approval, creditApproval],
  );

  return {
    t,
    empty,
    usingSeed,
    payment,
    setPaymentMethod,
    setCreditDays,
    saved,
    savedOffline,
    online,
    error,
    // Optimistic-save failure (SALT-155): a non-blocking banner with Retry; null when clear.
    failedSave: failedSave ? { message: failedSave.message, retryable: failedSave.retryable } : null,
    retryFailedSave,
    dismissFailedSave: () => setFailedSave(null),
    shopId,
    setupOpen,
    setSetupOpen,
    isInterstate,
    creditWarn,
    // Split-tender (SALT-198): the panes render the pane when `splitMode`, edit legs via
    // `setTenderAmount`/`fillRemainder`, and read `tenderChk` for the live remainder + gate.
    splitMode,
    setSplit,
    tenderAmounts,
    setTenderAmount,
    fillRemainder,
    tenderChk,
    // Discount-approval gate (SALT-206). `status`: ok | needed | pending | approved | rejected.
    discountGate: {
      over: discChk.over,
      status: !discChk.over
        ? ("ok" as const)
        : approval?.status === "pending"
          ? ("pending" as const)
          : discountApproved
            ? ("approved" as const)
            : approval?.status === "rejected"
              ? ("rejected" as const)
              : ("needed" as const),
      approverName: approval?.approverName ?? null,
      pct: discChk.pct,
      discountPaise,
      maxPct: discountLimits.maxPct,
      maxPaise: discountLimits.maxPaise,
    },
    cancelDiscountApproval: () => {
      if (approval?.status === "pending") void cancelApproval(approval.id);
      setApproval(null);
    },
    // Credit-limit override gate (SALT-175). Same status vocabulary as discountGate.
    creditGate: {
      over: creditWarn.over,
      status: !creditWarn.over
        ? ("ok" as const)
        : creditApproval?.status === "pending"
          ? ("pending" as const)
          : creditApproved
            ? ("approved" as const)
            : creditApproval?.status === "rejected"
              ? ("rejected" as const)
              : ("needed" as const),
      approverName: creditApproval?.approverName ?? null,
      grandPaise: t.grand,
      duePaise: credit?.duePaise ?? 0,
      limitPaise: credit?.creditLimitPaise ?? 0,
    },
    cancelCreditApproval: () => {
      if (creditApproval?.status === "pending") void cancelApproval(creditApproval.id);
      setCreditApproval(null);
    },
    // Per-bill GST series (SALT-209): `series` for the picker (shown only when >1), the
    // effective selection, and the setter.
    series,
    seriesId: seriesId ?? defaultSeriesId,
    setSeriesId,
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
