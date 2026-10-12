import { useEffect, useState } from "react";
import { HeartPulse, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/** Free-text clinical notes stored in `ledgers.clinical` (migration 0033). */
interface Clinical {
  conditions?: string;
  allergies?: string;
  regular_meds?: string;
}

/**
 * A customer's clinical notes (chronic conditions, allergies, regular meds) for
 * refill reminders + safer dispensing (SALT-052). Self-contained: it does its
 * own defensive fetch of `ledgers.clinical`, so if migration 0033 is not applied
 * yet the section simply hides itself rather than breaking the profile.
 */
export function ClinicalSection({ ledgerId }: { ledgerId: string }) {
  const [data, setData] = useState<Clinical>({});
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase
      .from("ledgers")
      .select("clinical")
      .eq("id", ledgerId)
      .maybeSingle()
      .then((r) => {
        if (!active) return;
        if (r.error) {
          // clinical column not present yet (0033 unapplied) — hide the section.
          setAvailable(false);
        } else {
          const c = ((r.data as { clinical?: Clinical } | null)?.clinical ?? {}) as Clinical;
          setData({ conditions: c.conditions ?? "", allergies: c.allergies ?? "", regular_meds: c.regular_meds ?? "" });
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledgerId]);

  function edit(key: keyof Clinical, value: string) {
    setData((d) => ({ ...d, [key]: value }));
    setDirty(true);
  }

  async function save() {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    const clinical: Clinical = {
      conditions: data.conditions?.trim() || undefined,
      allergies: data.allergies?.trim() || undefined,
      regular_meds: data.regular_meds?.trim() || undefined,
    };
    const { error: err } = await supabase.from("ledgers").update({ clinical }).eq("id", ledgerId);
    setBusy(false);
    if (err) setError(err.message);
    else setDirty(false);
  }

  if (loading || !available) return null;

  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-text-primary">
        <HeartPulse className="size-4 text-text-tertiary" /> Clinical
      </h2>
      <p className="mb-3 text-xs text-text-tertiary">
        Chronic conditions, allergies and regular medicines, for refill reminders and safer dispensing.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Chronic conditions">
          <Input value={data.conditions ?? ""} onChange={(e) => edit("conditions", e.target.value)} placeholder="e.g. Diabetes, Hypertension" className="h-9" />
        </Field>
        <Field label="Allergies">
          <Input value={data.allergies ?? ""} onChange={(e) => edit("allergies", e.target.value)} placeholder="e.g. Penicillin" className="h-9" />
        </Field>
        <Field label="Regular medicines">
          <Input value={data.regular_meds ?? ""} onChange={(e) => edit("regular_meds", e.target.value)} placeholder="e.g. Metformin 500mg" className="h-9" />
        </Field>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button className="mt-3" onClick={save} disabled={busy || !dirty}>
        <Save /> {busy ? "Saving…" : dirty ? "Save clinical" : "Saved"}
      </Button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}
