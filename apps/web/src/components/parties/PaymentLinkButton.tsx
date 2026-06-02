import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/integrations/WhatsAppButton";
import { createPaymentLink, paymentLinkMessage, isRazorpayReady } from "@/lib/razorpay";

/**
 * Create a Razorpay payment link for a customer's outstanding (SALT-231) and
 * share it over WhatsApp. Reuses the SALT-108 razorpay infra + the SALT-107
 * WhatsAppButton — no new transport. Renders nothing when nothing is due; the
 * create button is disabled (with a hint) until Razorpay is connected.
 */
export function PaymentLinkButton({
  duePaise,
  customerName,
  phone,
  referenceId,
  shopName,
}: {
  duePaise: number;
  customerName: string;
  phone: string | null;
  referenceId: string;
  shopName?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Nothing to collect → no action.
  if (duePaise <= 0) return null;

  // Once created, swap to a WhatsApp send of the link message (reuses WhatsAppButton).
  if (shortUrl) {
    return (
      <WhatsAppButton
        phone={phone}
        text={paymentLinkMessage({ customerName, shopName, amountPaise: duePaise, shortUrl })}
        label="Send link"
      />
    );
  }

  const ready = isRazorpayReady();

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createPaymentLink({
      amountPaise: duePaise,
      description: `Outstanding · ${customerName}`,
      customerName,
      phone,
      referenceId,
    });
    setBusy(false);
    if (res.ok && res.shortUrl) setShortUrl(res.shortUrl);
    else setError(res.error ?? "Could not create the payment link.");
  }

  return (
    <Button
      variant="outline"
      disabled={!ready || busy}
      title={
        ready
          ? error ?? "Create a Razorpay payment link for the amount due"
          : "Connect Razorpay in Settings to create payment links"
      }
      onClick={create}
    >
      <Link2 /> {busy ? "Creating…" : error ? "Retry link" : "Payment link"}
    </Button>
  );
}
