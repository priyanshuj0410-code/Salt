import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { MessageCircle, Printer, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { normalizePhoneForWa, whatsappUrl } from "@/lib/collection";
import {
  amountInWords,
  buildReceiptMessage,
  loadPaymentAllocations,
  type PaymentListRow,
  type ReceiptAllocation,
} from "@/lib/payments";

/**
 * A printable / shareable receipt for one recorded payment (SALT-057). The
 * receipt markup uses inline styles so it survives being copied verbatim into a
 * standalone print window (Tailwind classes would not). Print and WhatsApp stay
 * fully in-module; the wa.me/UPI helpers are reused from lib/collection.
 */
export function PaymentReceiptDialog({
  open,
  onOpenChange,
  payment,
  partyName,
  partyPhone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: PaymentListRow | null;
  partyName: string;
  partyPhone: string | null;
}) {
  const orgId = useAuth().membership?.orgId;
  const shop = useAuth().shop;
  const receiptRef = useRef<HTMLDivElement>(null);
  const [allocations, setAllocations] = useState<ReceiptAllocation[]>([]);

  useEffect(() => {
    if (!open || !orgId || !payment) return;
    let active = true;
    loadPaymentAllocations(orgId, payment.id)
      .then((a) => {
        if (active) setAllocations(a);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, orgId, payment]);

  if (!payment) return null;

  const dateLabel = format(new Date(payment.payment_date), "d MMM yyyy");
  const received = payment.direction === "received";
  const waPhone = normalizePhoneForWa(partyPhone);
  const waUrl = waPhone
    ? whatsappUrl(
        waPhone,
        buildReceiptMessage({
          shopName: shop?.name,
          direction: payment.direction,
          partyName,
          amountPaise: payment.amount_paise,
          mode: payment.mode,
          reference: payment.reference,
          dateLabel,
        }),
      )
    : null;

  function handlePrint() {
    const node = receiptRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=400,height=640");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>Receipt ${payment!.id.slice(0, 8)}</title>` +
        "<style>@page{margin:8mm}body{margin:0;display:flex;justify-content:center;background:#fff}" +
        "*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>" +
        `<body>${node.outerHTML}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Payment receipt</DialogTitle>
        </DialogHeader>

        {/* Receipt — inline-styled so it can be copied into the print window */}
        <div className="flex justify-center overflow-auto rounded-md border border-border bg-white p-3">
          <div ref={receiptRef} style={S.receipt}>
            <div style={S.center}>
              <div style={S.shopName}>{shop?.name || "Your Shop"}</div>
              {shop?.address && <div style={S.muted}>{shop.address}</div>}
              {shop?.gstin && <div style={S.muted}>GSTIN: {shop.gstin}</div>}
              {shop?.phone && <div style={S.muted}>Ph: {shop.phone}</div>}
            </div>
            <div style={S.rule} />
            <div style={{ ...S.center, ...S.heading }}>PAYMENT RECEIPT</div>
            <Row label="No." value={payment.id.slice(0, 8).toUpperCase()} />
            <Row label="Date" value={dateLabel} />
            <div style={S.dash} />
            <Row label={received ? "Received from" : "Paid to"} value={partyName} />
            <div style={S.amount}>{formatPaise(payment.amount_paise)}</div>
            <div style={{ ...S.center, ...S.words }}>{amountInWords(payment.amount_paise)}</div>
            <div style={S.dash} />
            <Row label="Mode" value={payment.mode.toUpperCase()} />
            {payment.reference && <Row label="Reference" value={payment.reference} />}
            {payment.notes && <Row label="Notes" value={payment.notes} />}
            {allocations.length > 0 && (
              <>
                <div style={S.dash} />
                <div style={S.muted}>Applied to:</div>
                {allocations.map((a, i) => (
                  <Row key={i} label={a.ref} value={formatPaise(a.allocated_paise)} />
                ))}
              </>
            )}
            <div style={S.rule} />
            <div style={{ ...S.center, ...S.muted }}>
              {received ? "Thank you for your payment." : "Payment confirmation."}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handlePrint}>
            <Printer /> Print
          </Button>
          <Button variant="outline" disabled={!waUrl} onClick={() => waUrl && window.open(waUrl, "_blank")}>
            <MessageCircle /> WhatsApp
          </Button>
          <Button variant="ghost" render={<Link to={`/parties/${payment.party_id}`} />}>
            <User /> View party
          </Button>
        </div>
        {!waUrl && <p className="text-xs text-text-tertiary">Add a phone number to the party to share on WhatsApp.</p>}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.row}>
      <span style={S.rowLabel}>{label}</span>
      <span style={S.rowValue}>{value}</span>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  receipt: {
    width: 280,
    fontFamily: "'Geist Mono', ui-monospace, monospace",
    fontSize: 12,
    lineHeight: 1.5,
    color: "#111111",
    background: "#ffffff",
  },
  center: { textAlign: "center" },
  shopName: { fontSize: 15, fontWeight: 700 },
  heading: { fontWeight: 700, letterSpacing: 1 },
  muted: { color: "#555555", fontSize: 11 },
  rule: { borderTop: "1px solid #111111", margin: "8px 0" },
  dash: { borderTop: "1px dashed #999999", margin: "6px 0" },
  amount: { textAlign: "center", fontSize: 20, fontWeight: 700, marginTop: 4 },
  words: { fontStyle: "italic", marginTop: 2 },
  row: { display: "flex", justifyContent: "space-between", gap: 8 },
  rowLabel: { color: "#555555", flex: "0 0 auto", maxWidth: "55%", overflowWrap: "anywhere" },
  rowValue: { textAlign: "right", fontWeight: 600, overflowWrap: "anywhere" },
};
