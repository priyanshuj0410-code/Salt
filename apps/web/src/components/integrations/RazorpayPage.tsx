import { useState } from "react";
import { Check, Copy, CreditCard, Link2, Plug } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { WhatsAppButton } from "./WhatsAppButton";
import {
  createPaymentLink,
  getRazorpayConfig,
  isRazorpayReady,
  paymentLinkMessage,
  saveRazorpayConfig,
  type CreateLinkResult,
  type RazorpayConfig,
} from "@/lib/razorpay";

const rupeesToPaise = (s: string): number => {
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Settings → Integrations → Razorpay (SALT-108). Connect the gateway and
 * generate a hosted payment link for a customer's outstanding, ready to share
 * over WhatsApp.
 */
export function RazorpayPage() {
  const { membership } = useAuth();
  const orgName = membership?.orgName ?? "";
  const [config, setConfig] = useState<RazorpayConfig>(() => getRazorpayConfig());
  const patch = (p: Partial<RazorpayConfig>) => setConfig(saveRazorpayConfig(p));

  return (
    <Page width="lg">
      <PageHeader
        icon={CreditCard}
        title="Razorpay"
        subtitle="Payment links for customer collections"
      />
      <ConnectionCard config={config} onPatch={patch} />
      <h2 className="mt-6 mb-3 text-sm font-medium text-muted-foreground">Create a payment link</h2>
      <ComposerCard ready={isRazorpayReady(config)} shopName={orgName} />
    </Page>
  );
}

function ConnectionCard({
  config,
  onPatch,
}: {
  config: RazorpayConfig;
  onPatch: (patch: Partial<RazorpayConfig>) => void;
}) {
  const ready = isRazorpayReady(config);
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" /> Connection
          <Badge variant={ready ? "success" : "neutral"}>{ready ? "Connected" : "Not connected"}</Badge>
        </CardTitle>
        <CardDescription>
          Link creation runs through the <code className="font-mono">razorpay-link</code> edge function,
          which holds the secret key. The publishable key id below is safe on the client.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Key id" hint="Publishable: rzp_live_… or rzp_test_…">
          <Input
            value={config.keyId}
            onChange={(e) => onPatch({ keyId: e.target.value })}
            placeholder="rzp_test_…"
            className="font-mono text-xs"
          />
        </Field>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-sm">
            <span className="font-medium">Create links via Razorpay</span>
            <span className="block text-xs text-muted-foreground">
              Requires the <code className="font-mono">razorpay-link</code> edge function deployed with{" "}
              <code className="font-mono">RAZORPAY_KEY_ID</code> and{" "}
              <code className="font-mono">RAZORPAY_KEY_SECRET</code> secrets set.
            </span>
          </span>
        </label>

        {config.enabled && (
          <Field label="Edge function URL" hint="e.g. https://<project>.supabase.co/functions/v1/razorpay-link">
            <Input
              value={config.endpointUrl}
              onChange={(e) => onPatch({ endpointUrl: e.target.value })}
              placeholder="https://…/functions/v1/razorpay-link"
              className="font-mono text-xs"
            />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

function ComposerCard({ ready, shopName }: { ready: boolean; shopName: string }) {
  const [amount, setAmount] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateLinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  const amountPaise = rupeesToPaise(amount);
  const canCreate = ready && amountPaise > 0 && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setResult(null);
    setCopied(false);
    try {
      setResult(
        await createPaymentLink({
          amountPaise,
          description: description.trim() || "Payment due",
          customerName: customer,
          phone,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const link = result?.ok ? result.shortUrl : undefined;
  const shareText = link
    ? paymentLinkMessage({ customerName: customer, shopName, amountPaise, shortUrl: link })
    : "";

  return (
    <Card>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3">
          <Field label="Amount (₹)">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
          </Field>
          <Field label="Customer name">
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Ramesh Medical" />
          </Field>
          <Field label="Mobile" hint="For SMS notification + WhatsApp share.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="e.g. 98765 43210" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Payment due" />
          </Field>
          <Button onClick={() => void create()} disabled={!canCreate}>
            <Link2 /> {busy ? "Creating…" : "Create payment link"}
          </Button>
          {!ready && (
            <p className="text-[11px] text-muted-foreground">
              Connect Razorpay above to create live links.
            </p>
          )}
        </div>

        <div className="grid content-start gap-2">
          {link ? (
            <>
              <span className="text-xs font-medium text-muted-foreground">Payment link</span>
              <div className="flex items-center gap-2">
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-sm text-primary underline-offset-4 hover:underline"
                >
                  {link}
                </a>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => void copy(link)}>
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
              <span className="mt-2 text-xs font-medium text-muted-foreground">Share</span>
              <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 font-sans text-sm whitespace-pre-wrap">
                {shareText}
              </pre>
              <WhatsAppButton phone={phone} text={shareText} label="Send link on WhatsApp" />
            </>
          ) : result && !result.ok ? (
            <p className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {result.error}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The hosted Razorpay link will appear here, ready to copy or send on WhatsApp.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
