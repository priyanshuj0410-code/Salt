import { useMemo, useState } from "react";
import { Check, Copy, MessageCircle, Plug } from "lucide-react";
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
  WHATSAPP_TEMPLATES,
  getWhatsAppConfig,
  isCloudApiReady,
  normalizePhoneForWa,
  saveWhatsAppConfig,
  templateSample,
  type WaTemplate,
  type WhatsAppConfig,
} from "@/lib/whatsapp";

/**
 * Settings → Integrations → WhatsApp (SALT-107). Manage the connection mode and
 * preview / compose every message template against a recipient.
 */
export function WhatsAppPage() {
  const { membership } = useAuth();
  const orgName = membership?.orgName ?? "";
  const [config, setConfig] = useState<WhatsAppConfig>(() => getWhatsAppConfig());
  const patch = (p: Partial<WhatsAppConfig>) => setConfig(saveWhatsAppConfig(p));

  return (
    <Page width="lg">
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp"
        subtitle="Send infrastructure and message templates"
      />

      <ConnectionCard config={config} onPatch={patch} />

      <h2 className="mt-6 mb-3 text-sm font-medium text-muted-foreground">Message templates</h2>
      <div className="grid gap-4">
        {WHATSAPP_TEMPLATES.map((t) => (
          <TemplateCard key={t.id} template={t} defaultShopName={config.senderName || orgName} />
        ))}
      </div>
    </Page>
  );
}

function ConnectionCard({
  config,
  onPatch,
}: {
  config: WhatsAppConfig;
  onPatch: (patch: Partial<WhatsAppConfig>) => void;
}) {
  const ready = isCloudApiReady(config);
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" /> Connection
          <Badge variant={ready ? "success" : "neutral"}>
            {ready ? "Business API" : "Click-to-chat"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Click-to-chat opens WhatsApp with the message pre-filled — works today, no setup. Enable the
          Business API to send automatically from the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Sender name" hint="Business name used as the default in templates.">
          <Input
            value={config.senderName}
            onChange={(e) => onPatch({ senderName: e.target.value })}
            placeholder="e.g. Santosh Medical"
          />
        </Field>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={config.cloudApiEnabled}
            onChange={(e) => onPatch({ cloudApiEnabled: e.target.checked })}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-sm">
            <span className="font-medium">Send via WhatsApp Business API</span>
            <span className="block text-xs text-muted-foreground">
              Requires the <code className="font-mono">whatsapp-send</code> edge function deployed with{" "}
              <code className="font-mono">WHATSAPP_TOKEN</code> and{" "}
              <code className="font-mono">WHATSAPP_PHONE_NUMBER_ID</code> secrets set.
            </span>
          </span>
        </label>

        {config.cloudApiEnabled && (
          <Field label="Edge function URL" hint="e.g. https://<project>.supabase.co/functions/v1/whatsapp-send">
            <Input
              value={config.endpointUrl}
              onChange={(e) => onPatch({ endpointUrl: e.target.value })}
              placeholder="https://…/functions/v1/whatsapp-send"
              className="font-mono text-xs"
            />
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateCard({
  template,
  defaultShopName,
}: {
  template: WaTemplate;
  defaultShopName: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const sample = templateSample(template);
    if ("shopName" in sample && defaultShopName) sample.shopName = defaultShopName;
    return sample;
  });
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => template.build(values), [template, values]);
  const phoneValid = normalizePhoneForWa(phone) != null;

  async function copy() {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {template.label}
          <Badge variant="neutral">{template.audience}</Badge>
        </CardTitle>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3">
          {template.fields.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                value={values[f.key] ?? ""}
                inputMode={f.kind === "amount" ? "decimal" : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field
            label="Recipient mobile"
            hint={phone && !phoneValid ? "Enter a valid 10-digit mobile." : undefined}
          >
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 98765 43210"
              inputMode="tel"
            />
          </Field>
        </div>

        <div className="grid content-start gap-2">
          <span className="text-xs font-medium text-muted-foreground">Preview</span>
          <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-sans text-sm whitespace-pre-wrap">
            {text}
          </pre>
          <div className="flex gap-2">
            <WhatsAppButton phone={phone} text={text} label="Open in WhatsApp" />
            <Button type="button" size="sm" variant="ghost" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Business API template: <code className="font-mono">{template.cloudTemplateName}</code>
          </span>
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
