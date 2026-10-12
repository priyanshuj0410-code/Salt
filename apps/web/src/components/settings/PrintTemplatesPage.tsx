import { useEffect, useMemo, useState } from "react";
import { Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { supabase } from "@/lib/supabase";
import { useAuth, type Shop } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { invalidateInvoiceConfig } from "@/lib/print";
import {
  DEFAULT_FORMAT,
  DEFAULT_INVOICE_TEMPLATE,
  PRINT_FORMAT_LABELS,
  type InvoiceTemplate,
  type PrintFormat,
  normalizeFormat,
  normalizeTemplate,
} from "@/lib/printTemplate";

const SELECT = "id,format,template";

/** Settings → Print templates. Edits the default sales-invoice template with a live preview. */
export function PrintTemplatesPage() {
  const { membership, shop } = useAuth();
  const orgId = membership?.orgId;

  const [format, setFormat] = useState<PrintFormat>(DEFAULT_FORMAT);
  const [tpl, setTpl] = useState<InvoiceTemplate>(DEFAULT_INVOICE_TEMPLATE);
  const [rowId, setRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("print_templates")
        .select(SELECT)
        .eq("org_id", orgId)
        .eq("doc_type", "sales_invoice")
        .eq("is_default", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (data) {
        setRowId(data.id as string);
        setFormat(normalizeFormat(data.format));
        setTpl(normalizeTemplate(data.template));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId]);

  function editTpl<K extends keyof InvoiceTemplate>(field: K, value: InvoiceTemplate[K]) {
    setTpl((t) => ({ ...t, [field]: value }));
    setDirty(true);
    setSavedTick(false);
  }
  function editFormat(next: PrintFormat) {
    setFormat(next);
    setDirty(true);
    setSavedTick(false);
  }

  async function save() {
    if (!supabase || !orgId || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (rowId) {
        const { error: err } = await supabase
          .from("print_templates")
          .update({ format, template: tpl })
          .eq("id", rowId);
        if (err) {
          setError(err.message);
          return;
        }
      } else {
        const { data, error: err } = await supabase
          .from("print_templates")
          .insert({
            org_id: orgId,
            doc_type: "sales_invoice",
            name: "Default invoice",
            format,
            template: tpl,
            is_default: true,
          })
          .select("id")
          .single();
        if (err) {
          setError(err.message);
          return;
        }
        setRowId(data.id as string);
      }
      // The print path caches the invoice config per session (SALT-165); clear it
      // so the very next bill print reflects this save without a page reload.
      invalidateInvoiceConfig();
      setDirty(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Page width="lg">
        <PageHeader icon={Printer} title="Print templates" />
        <p className="text-sm text-text-tertiary">Loading…</p>
      </Page>
    );
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={Printer}
        title="Print templates"
        subtitle="Customise the sales invoice / receipt, paper, header, footer and terms."
        actions={
          <Button onClick={save} disabled={busy || !dirty}>
            <Save /> {busy ? "Saving…" : dirty ? "Save" : savedTick ? "Saved ✓" : "Saved"}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Editor */}
        <section className="space-y-4">
          <div className="rounded-lg border bg-background p-4">
            <h2 className="text-sm font-medium">Paper</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Format">
                <select
                  value={format}
                  onChange={(e) => editFormat(e.target.value as PrintFormat)}
                  className={selectCls}
                >
                  {(Object.keys(PRINT_FORMAT_LABELS) as PrintFormat[]).map((f) => (
                    <option key={f} value={f}>
                      {PRINT_FORMAT_LABELS[f]}
                    </option>
                  ))}
                </select>
              </Field>
              {format === "thermal" && (
                <Field label="Roll width">
                  <select
                    value={tpl.thermal_width}
                    onChange={(e) => editTpl("thermal_width", Number(e.target.value) === 58 ? 58 : 80)}
                    className={selectCls}
                  >
                    <option value={80}>80 mm</option>
                    <option value={58}>58 mm</option>
                  </select>
                </Field>
              )}
              <Field label="Copies">
                <select
                  value={tpl.copies}
                  onChange={(e) => editTpl("copies", Number(e.target.value))}
                  className={selectCls}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <h2 className="text-sm font-medium">Header</h2>
            <div className="mt-3 space-y-3">
              <Field label="Tagline" hint="Printed under the shop name. Leave blank to omit.">
                <Input
                  value={tpl.header_tagline}
                  onChange={(e) => editTpl("header_tagline", e.target.value)}
                  placeholder="e.g. Retail Chemist & Druggist"
                />
              </Field>
              <Toggle
                checked={tpl.show_gstin}
                onChange={(v) => editTpl("show_gstin", v)}
                label="Show shop GSTIN in header"
              />
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <h2 className="text-sm font-medium">Line items</h2>
            <div className="mt-3">
              <Toggle
                checked={tpl.show_batch_expiry}
                onChange={(v) => editTpl("show_batch_expiry", v)}
                label="Show batch no. & expiry under each item"
              />
            </div>
          </div>

          <div className="rounded-lg border bg-background p-4">
            <h2 className="text-sm font-medium">Footer</h2>
            <div className="mt-3 space-y-3">
              <Field label="Thank-you line">
                <Input
                  value={tpl.footer_text}
                  onChange={(e) => editTpl("footer_text", e.target.value)}
                  placeholder="e.g. Thank you. Get well soon."
                />
              </Field>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Terms &amp; conditions</span>
                <textarea
                  value={tpl.terms_text}
                  onChange={(e) => editTpl("terms_text", e.target.value)}
                  rows={2}
                  placeholder="e.g. Goods once sold are not returnable. Subject to local jurisdiction."
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm focus-visible:border-ring"
                />
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </section>

        {/* Preview */}
        <section>
          <div className="sticky top-4">
            <div className="mb-2 text-xs font-medium tracking-wide text-text-tertiary uppercase">
              Preview · {PRINT_FORMAT_LABELS[format]}
              {format === "thermal" ? ` ${tpl.thermal_width} mm` : ""}
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <ReceiptPreview format={format} tpl={tpl} shop={shop} />
            </div>
            <p className="mt-2 text-xs text-text-tertiary">
              Illustrative preview with sample data. Applies to printed bills once the billing print
              path consumes this template.
            </p>
          </div>
        </section>
      </div>
    </Page>
  );
}

const SAMPLE_LINES = [
  { name: "Augmentin 625 Duo Tab", pack: "10 tabs", batchNo: "AMX2241", expiry: "08/27", qty: 2, mrpPaise: 22500, amtPaise: 41800 },
  { name: "Pan-D Capsule", pack: "15 caps", batchNo: "PD5510", expiry: "11/26", qty: 1, mrpPaise: 19900, amtPaise: 18800 },
  { name: "Dolo 650 Tab", pack: "15 tabs", batchNo: "DL8830", expiry: "03/28", qty: 3, mrpPaise: 3400, amtPaise: 9600 },
];

function ReceiptPreview({ format, tpl, shop }: { format: PrintFormat; tpl: InvoiceTemplate; shop: Shop | null }) {
  const width = format === "thermal" ? (tpl.thermal_width === 58 ? 188 : 264) : 340;
  const { taxable, gst, grand } = useMemo(() => {
    const t = SAMPLE_LINES.reduce((s, l) => s + l.amtPaise, 0);
    const g = Math.round(t * 0.12);
    return { taxable: t, gst: g, grand: t + g };
  }, []);

  return (
    <div className="flex justify-center overflow-x-auto">
      <div
        style={{ width }}
        className="shrink-0 rounded-sm bg-white px-3 py-3 font-mono text-[10px] leading-relaxed text-black shadow-sm"
      >
        <div className="text-center">
          <div className="text-[13px] font-bold">{shop?.name ?? "Your Shop Name"}</div>
          {tpl.header_tagline && <div className="text-[10px]">{tpl.header_tagline}</div>}
          <div className="text-[9px] text-neutral-600">
            {shop?.address ?? "Shop address, City"}
            {shop?.phone ? (
              <>
                <br />
                Ph: {shop.phone}
              </>
            ) : null}
            {tpl.show_gstin ? (
              <>
                <br />
                GSTIN: {shop?.gstin ?? "-"}
              </>
            ) : null}
          </div>
        </div>

        <Dash />
        <div className="flex justify-between">
          <span>Tax Invoice</span>
          <span>01 Jun, 2:30 pm</span>
        </div>
        <div className="flex justify-between">
          <span>Ref: 3F9A2C10</span>
          <span>Cash</span>
        </div>
        <div className="mt-1 font-semibold">Walk-in customer</div>

        <Dash />
        <table className="w-full">
          <thead>
            <tr className="border-b border-black text-[9px] uppercase text-neutral-600">
              <th className="py-0.5 text-left font-medium">Item</th>
              <th className="py-0.5 text-right font-medium">Qty</th>
              <th className="py-0.5 text-right font-medium">Amt</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_LINES.map((l) => (
              <tr key={l.name} className="border-b border-dotted border-neutral-300 align-top">
                <td className="py-0.5 text-left">
                  {l.name}
                  <div className="text-[9px] text-neutral-500">
                    {[l.pack, tpl.show_batch_expiry && `B: ${l.batchNo}`, tpl.show_batch_expiry && `Exp ${l.expiry}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </td>
                <td className="py-0.5 text-right tabular-nums">{l.qty}</td>
                <td className="py-0.5 text-right tabular-nums">{formatPaise(l.amtPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Dash />
        <Row label="Taxable" value={formatPaise(taxable)} />
        <Row label="GST (12%)" value={formatPaise(gst)} />
        <div className="mt-1 flex justify-between border-t border-black pt-1 text-[12px] font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPaise(grand)}</span>
        </div>

        <Dash dashed />
        {tpl.footer_text && <div className="text-center">{tpl.footer_text}</div>}
        {tpl.terms_text && <div className="mt-1 text-center text-[9px] text-neutral-600">{tpl.terms_text}</div>}
        {tpl.copies > 1 && (
          <div className="mt-1 text-center text-[9px] text-neutral-500">({tpl.copies} copies will print)</div>
        )}
      </div>
    </div>
  );
}

const Dash = ({ dashed }: { dashed?: boolean }) => (
  <div className={`my-1.5 border-t ${dashed ? "border-dashed" : "border-solid"} border-neutral-400`} />
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:border-ring";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
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
