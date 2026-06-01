import { useEffect, useState } from "react";
import { Percent, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * Settings → Discount limits (SALT-016, settings lane).
 *
 * Stores the org's discount policy in `org_settings.settings`:
 *   { discount_max_pct: number|null, discount_max_paise: number|null }
 * Blank = no limit. The checkout gate that enforces these (raising a
 * `discount_override` approval_request when exceeded) is billing-owned — see the
 * filed follow-on ticket. Other keys in the jsonb blob are preserved on save.
 */
export function DiscountLimitsPage() {
  const orgId = useAuth().membership?.orgId;
  const [base, setBase] = useState<Record<string, unknown>>({});
  const [pctStr, setPctStr] = useState("");
  const [capStr, setCapStr] = useState("");
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("org_settings")
      .select("settings")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const s = ((data?.settings as Record<string, unknown> | null) ?? {});
        setBase(s);
        const pct = s.discount_max_pct;
        const paise = s.discount_max_paise;
        setPctStr(typeof pct === "number" ? String(pct) : "");
        setCapStr(typeof paise === "number" ? String(paise / 100) : "");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  function edit(setter: (v: string) => void, v: string) {
    setter(v);
    setDirty(true);
    setSavedTick(false);
    setError(null);
  }

  async function save() {
    if (!supabase || !orgId || busy) return;

    const pct = pctStr.trim() === "" ? null : Number(pctStr);
    const rupees = capStr.trim() === "" ? null : Number(capStr);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError("Max discount % must be between 0 and 100.");
      return;
    }
    if (rupees !== null && (!Number.isFinite(rupees) || rupees < 0)) {
      setError("Flat cap must be a positive amount.");
      return;
    }
    const paise = rupees === null ? null : Math.round(rupees * 100);

    setBusy(true);
    setError(null);
    const next = { ...base, discount_max_pct: pct, discount_max_paise: paise };
    try {
      const { error: err } = await supabase
        .from("org_settings")
        .upsert({ org_id: orgId, settings: next, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
      if (err) {
        setError(err.message);
        return;
      }
      setBase(next);
      setDirty(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="md">
      <PageHeader
        icon={Percent}
        title="Discount limits"
        subtitle="Cap how much a cashier can discount before a manager has to approve."
        actions={
          <Button onClick={save} disabled={busy || !dirty || loading}>
            <Save /> {busy ? "Saving…" : dirty ? "Save" : savedTick ? "Saved ✓" : "Saved"}
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : (
        <section className="rounded-lg border bg-background p-4">
          <p className="text-sm text-text-secondary">
            When a line or bill discount exceeds either limit, checkout will require manager approval
            (raised to the Approvals inbox). Leave a field blank for no limit.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Max discount %" hint="e.g. 10 — discounts above 10% need approval.">
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={pctStr}
                  onChange={(e) => edit(setPctStr, e.target.value)}
                  placeholder="No limit"
                  className="pr-7"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
                  %
                </span>
              </div>
            </Field>
            <Field label="Flat cap (₹)" hint="Optional rupee cap on discount per bill.">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">
                  ₹
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={capStr}
                  onChange={(e) => edit(setCapStr, e.target.value)}
                  placeholder="No limit"
                  className="pl-6"
                />
              </div>
            </Field>
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </section>
      )}
    </Page>
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
