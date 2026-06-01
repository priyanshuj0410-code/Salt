import { addDays, format } from "date-fns";
import { Banknote, CalendarClock, Check, Printer, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatPaise, formatSigned } from "@/lib/currency";
import { gstSplit } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { useBill } from "@/store/bill";
import { useHeldBills } from "@/store/heldBills";
import { GstinPrompt } from "./GstinPrompt";
import { H1Notice } from "./H1Gate";
import { CreditNotice } from "./CreditNotice";
import { SplitTender } from "./SplitTender";
import { DiscountApprovalNotice } from "./DiscountApprovalNotice";
import type { Checkout } from "./useCheckout";

const CREDIT_PRESETS = [7, 15, 30];

export function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? "text-text-tertiary" : ""}>{label}</span>
      <span className={cn("tabular-nums", muted && "text-text-tertiary")}>{value}</span>
    </div>
  );
}

/** Whole-bill discount control (pct / flat ₹). Apportioned across lines in `billTotals`. */
export function BillDiscountInput() {
  const bill = useBill((s) => s.billDiscount);
  const setBill = useBill((s) => s.setBillDiscount);
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-text-tertiary">Bill discount</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={bill.type === "pct" ? 100 : undefined}
          value={bill.type === "pct" ? bill.value : bill.value / 100}
          onChange={(e) => {
            const v = Number(e.target.value) || 0;
            setBill({ type: bill.type, value: bill.type === "pct" ? v : Math.round(v * 100) });
          }}
          aria-label="Bill-level discount"
          className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <Button
          variant="outline"
          size="icon-xs"
          aria-label="Toggle bill discount type"
          title={bill.type === "pct" ? "Percent" : "Flat rupees"}
          onClick={() => setBill({ type: bill.type === "pct" ? "flat" : "pct", value: 0 })}
        >
          {bill.type === "pct" ? "%" : "₹"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Desktop presentation of the ActionBar: a fixed right pane with the full bill
 * breakdown, payment picker, GSTIN prompt and the Save (F9) button. All logic
 * comes from `useCheckout` (held once in BillingScreen) via props, so this and
 * `MobileCheckout` stay in sync. Hidden below `md` — the mobile sticky bar takes
 * over there.
 */
export function BillSummary({
  checkout,
  customerGstin,
  onCustomerUpdated,
}: {
  checkout: Checkout;
  customerGstin: string | null;
  onCustomerUpdated: () => void;
}) {
  const party = useBill((s) => s.party);
  const clear = useBill((s) => s.clear);
  const hold = useHeldBills((s) => s.hold);
  const { t, empty, usingSeed, payment, setPaymentMethod, setCreditDays, saving, saved, savedOffline, error, shopId } = checkout;
  const { needsRx, rxCaptured, rx, openRx, isInterstate, saveAndPrint, saveOnly, creditWarn } = checkout;
  const { splitMode, setSplit, tenderAmounts, setTenderAmount, fillRemainder, tenderChk } = checkout;
  const { discountGate, cancelDiscountApproval } = checkout;
  // Save is blocked while a split does not balance, or while an over-limit discount is
  // awaiting manager approval (the server / gate would reject it anyway).
  const blockSave =
    empty || saving || usingSeed || !shopId || (splitMode && !tenderChk.ok) || discountGate.status === "pending";
  const tax = gstSplit(t.gst, isInterstate);
  const marginPct = t.grand > 0 ? Math.round((t.margin / t.grand) * 100) : 0;
  const loss = t.margin < 0;

  return (
    <div className="hidden flex-col gap-3 overflow-auto rounded-lg border border-border p-4 md:flex">
      <Row label="Gross (MRP)" value={formatPaise(t.gross)} muted />
      <Row
        label="Discount"
        value={t.discount > 0 ? `− ${formatPaise(t.discount)}` : formatPaise(0)}
        muted
      />
      <BillDiscountInput />
      {t.billDiscount > 0 && (
        <Row label="Bill discount applied" value={`− ${formatPaise(t.billDiscount)}`} muted />
      )}
      <Row label="Taxable value" value={formatPaise(t.taxable)} muted />
      {isInterstate ? (
        <Row label="IGST" value={formatPaise(tax.igst)} muted />
      ) : (
        <>
          <Row label="CGST" value={formatPaise(tax.cgst)} muted />
          <Row label="SGST" value={formatPaise(tax.sgst)} muted />
        </>
      )}
      <Separator />
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Total payable</span>
        <span className="text-2xl font-semibold tabular-nums">{formatPaise(t.grand)}</span>
      </div>

      <div
        className={cn(
          "flex items-center justify-between rounded-md px-3 py-2",
          loss ? "bg-danger-bg text-danger" : "bg-success-bg text-success",
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {loss ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
          {loss ? "Est. loss" : "Est. earnings"}
        </span>
        <span className="text-right">
          <span className="font-semibold tabular-nums">{formatSigned(t.margin)}</span>
          <span className="ml-1.5 text-xs tabular-nums opacity-80">{marginPct}%</span>
        </span>
      </div>

      {party && !customerGstin && <GstinPrompt partyId={party.id} onSaved={onCustomerUpdated} />}

      <Separator />

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-text-tertiary">Payment</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => setSplit(!splitMode)}
          >
            {splitMode ? "Single payment" : "Split payment"}
          </Button>
        </div>

        {splitMode ? (
          <SplitTender
            amounts={tenderAmounts}
            setAmount={setTenderAmount}
            fillRemainder={fillRemainder}
            check={tenderChk}
            creditDays={payment.creditDays}
            setCreditDays={setCreditDays}
            hasParty={party !== null}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={payment.method === "cash" ? "default" : "outline"}
                onClick={() => setPaymentMethod("cash")}
              >
                <Banknote />
                Cash
              </Button>
              <Button
                variant={payment.method === "credit" ? "default" : "outline"}
                onClick={() => setPaymentMethod("credit")}
              >
                <CalendarClock />
                Credit
              </Button>
            </div>

            {payment.method === "credit" && (
              <div className="mt-2 rounded-md border border-border p-2.5">
                <p className="mb-1.5 text-xs text-text-tertiary">Repayment period</p>
                <div className="flex items-center gap-1.5">
                  {CREDIT_PRESETS.map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={payment.creditDays === d ? "secondary" : "outline"}
                      onClick={() => setCreditDays(d)}
                    >
                      {d}d
                    </Button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    value={payment.creditDays}
                    onChange={(e) => setCreditDays(Number(e.target.value) || 0)}
                    aria-label="Custom repayment days"
                    className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <span className="text-sm text-text-tertiary">days</span>
                </div>
                <p className="mt-1.5 text-xs text-text-tertiary">
                  Due by{" "}
                  <span className="font-medium text-text-primary">
                    {format(addDays(new Date(), payment.creditDays), "d MMM yyyy")}
                  </span>
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-2">
        {needsRx && (
          <H1Notice rxCaptured={rxCaptured} doctorName={rx?.doctorName} onEdit={openRx} />
        )}
        <DiscountApprovalNotice gate={discountGate} onCancel={cancelDiscountApproval} />
        {creditWarn.over && <CreditNotice check={creditWarn} />}
        <Button
          size="lg"
          disabled={blockSave}
          onClick={() => saveAndPrint()}
          title={usingSeed ? "Import your items to save bills" : undefined}
        >
          {saved || savedOffline ? <Check /> : <Printer />}
          {saved
            ? "Saved"
            : savedOffline
              ? "Saved offline"
              : saving
                ? "Saving…"
                : "Save & Print · F9"}
        </Button>
        {usingSeed && (
          <p className="text-center text-xs text-text-tertiary">
            Demo catalogue — import your items to save bills.
          </p>
        )}
        {error && <p className="text-center text-xs text-destructive">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={blockSave}
            onClick={() => saveOnly()}
          >
            Save only
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={empty || !shopId}
            onClick={() => shopId && hold(shopId)}
          >
            Hold · F4
          </Button>
        </div>
        <Button variant="ghost" size="sm" disabled={empty} onClick={clear}>
          Clear bill
        </Button>
      </div>
    </div>
  );
}
