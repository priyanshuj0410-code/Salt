import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizePhoneForWa, sendWhatsApp, type SendResult } from "@/lib/whatsapp";

/**
 * Reusable WhatsApp send action (SALT-107). Drop this into any screen that has
 * a recipient phone and a message: parties (reminder), bills (invoice share),
 * GRN (PO / near-expiry to vendor). It routes through `sendWhatsApp`, so it
 * uses the Business API when the shop has enabled it and otherwise opens the
 * click-to-chat link — callers don't need to know which.
 */
export function WhatsAppButton({
  phone,
  text,
  label = "WhatsApp",
  size = "sm",
  variant = "outline",
  className,
  onSent,
}: {
  phone: string | null | undefined;
  text: string;
  label?: string;
  size?: "xs" | "sm" | "default" | "md" | "lg";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  onSent?: (result: SendResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const enabled = normalizePhoneForWa(phone) != null && text.trim().length > 0;

  async function send() {
    if (!enabled || busy) return;
    setBusy(true);
    try {
      const result = await sendWhatsApp({ phone, text });
      if (result.channel === "click-to-chat" && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
      onSent?.(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={!enabled || busy}
      onClick={() => void send()}
      title={enabled ? undefined : "No valid mobile number"}
    >
      <MessageCircle /> {busy ? "Sending…" : label}
    </Button>
  );
}
