import { useState } from "react";
import { addDays, format } from "date-fns";
import { Banknote, CalendarClock, Check, ChevronDown, ChevronUp, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPaise, formatSigned } from "@/lib/currency";
import { gstSplit } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { useBill } from "@/store/bill";
import { GstinPrompt } from "./GstinPrompt";
import { Row, BillDiscountInput } from "./BillSummary";
import { H1Notice } from "./H1Gate";
import { CreditNotice } from "./CreditNotice";
import type { Checkout } from "./useCheckout";

const CREDIT_PRESETS = [7, 15, 30];

/**
 * Mobile presentation of the ActionBar: a static bar pinned at the bottom of the
 * counter (thumb zone) showing item count + payment mode + live total, with the
 * primary **Charge ₹X** action. Tapping the total expands the full breakdown,
 * payment picker, GSTIN prompt and Clear — keeping the default view to just the
 * one action (L3 + L6). Same logic as the desktop pane, via the shared `checkout`.
 */
export function MobileCheckout({
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
  const parkBill = useBill((s) => s.parkBill);
  const { t, empty, usingSeed, payment, setPaymentMethod, setCreditDays, saving, saved, error } = checkout;
  const { needsRx, rxCaptured, rx, openRx, isInterstate, saveAndPrint, saveOnly, creditWarn } = checkout;
  const tax = gstSplit(t.gst, isInterstate);
  const [open, setOpen] = useState(false);
  const loss = t.margin < 0;

  // Nothing to charge yet — keep the screen for the search + lines.
  if (empty) return null;

  return (
    <div className="border-t border-border bg-background md:hidden">
      {open && (
        <div className="max-h-[55vh] space-y-2 overflow-auto border-b border-border p-3">
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
          <div className={cn("flex justify-between text-sm font-medium", loss ? "text-danger" : "text-success")}>
            <span>{loss ? "Est. loss" : "Est. earnings"}</span>
            <span className="tabular-nums">{formatSigned(t.margin)}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
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
            <div className="flex flex-wrap items-center gap-1.5">
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
              <span className="text-xs text-text-tertiary">
                due {format(addDays(new Date(), payment.creditDays), "d MMM")}
              </span>
            </div>
          )}

          {party && !customerGstin && <GstinPrompt partyId={party.id} onSaved={onCustomerUpdated} />}

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={saving || usingSeed}
              onClick={() => saveOnly()}
            >
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={parkBill}>
              Hold
            </Button>
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {needsRx && (
        <div className="px-3 pt-3">
          <H1Notice rxCaptured={rxCaptured} doctorName={rx?.doctorName} onEdit={openRx} />
        </div>
      )}
      {creditWarn.over && (
        <div className="px-3 pt-3">
          <CreditNotice check={creditWarn} />
        </div>
      )}

      <div className="flex items-center gap-3 p-3">
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-label="Toggle bill breakdown">
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            {t.items} item{t.items !== 1 ? "s" : ""} · {payment.method === "credit" ? "Credit" : "Cash"}
            {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </div>
          <div className="text-lg font-semibold tabular-nums">{formatPaise(t.grand)}</div>
        </button>
        <Button size="lg" disabled={saving || usingSeed} onClick={() => saveAndPrint()}>
          {saved ? (
            <>
              <Check /> Saved
            </>
          ) : saving ? (
            "Saving…"
          ) : (
            <>
              <Printer /> {formatPaise(t.grand)}
            </>
          )}
        </Button>
      </div>
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      {usingSeed && (
        <p className="px-3 pb-2 text-center text-xs text-text-tertiary">
          Demo catalogue — import your items to save bills.
        </p>
      )}
    </div>
  );
}
