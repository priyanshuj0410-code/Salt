import { useState } from "react";
import { Copy, Mail, MessageCircle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizePhoneForWa, whatsappUrl } from "@/lib/collection";
import { formatPoText, type PoTextLine } from "@/lib/grn";

/**
 * Send a purchase order to its vendor. Vendor ordering has no self-serve API
 * (ADR 0016), so the channels are WhatsApp / email / copy / print of a formatted
 * PO. WhatsApp + email mark the PO "sent" (via onSent); copy/print don't.
 */
export function SendPoDialog({
  open,
  onOpenChange,
  shopName,
  vendorName,
  vendorPhone,
  poRef,
  date,
  expectedDate,
  lines,
  totalPaise,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopName?: string | null;
  vendorName: string;
  vendorPhone: string | null;
  poRef: string;
  date: string;
  expectedDate?: string | null;
  lines: PoTextLine[];
  totalPaise: number;
  /** Called after a WhatsApp/email send so the caller can flip status → sent. */
  onSent: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = formatPoText({ shopName, vendorName, poRef, date, expectedDate, lines, totalPaise });
  const waPhone = normalizePhoneForWa(vendorPhone);
  const subject = `Purchase Order ${poRef}${shopName ? ` from ${shopName}` : ""}`;

  function sendWhatsApp() {
    if (!waPhone) return;
    window.open(whatsappUrl(waPhone, text), "_blank", "noopener,noreferrer");
    onSent();
    onOpenChange(false);
  }

  function sendEmail() {
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
    onSent();
    onOpenChange(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function print() {
    const w = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!w) return;
    w.document.write(
      `<pre style="font:13px ui-monospace,Menlo,monospace;white-space:pre-wrap;padding:24px">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)}</pre>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send PO to {vendorName}</DialogTitle>
          <DialogDescription>WhatsApp or email the order, or copy/print it. Distributors have no direct ordering API.</DialogDescription>
        </DialogHeader>

        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-surface p-3 text-xs whitespace-pre-wrap">
          {text}
        </pre>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={sendWhatsApp}
            disabled={!waPhone}
            title={waPhone ? "Open WhatsApp with the PO" : "Add a vendor phone number to send on WhatsApp"}
          >
            <MessageCircle /> WhatsApp
          </Button>
          <Button variant="outline" onClick={sendEmail}>
            <Mail /> Email
          </Button>
          <Button variant="outline" onClick={copy}>
            <Copy /> {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="outline" onClick={print}>
            <Printer /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
