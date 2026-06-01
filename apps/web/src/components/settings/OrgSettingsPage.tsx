import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Building2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormRow } from "@/components/patterns/form-row";
import { UserMenu } from "@/components/auth/UserMenu";
import { supabase } from "@/lib/supabase";
import { useAuth, type Shop } from "@/lib/auth";
import { INDIAN_STATE_CODES, stateName } from "@/lib/stateCodes";

/** Editable settings for the org's primary shop — used by GST/RPC flows. */
export function OrgSettingsPage() {
  const { membership, shop } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Settings · Organisation</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Link
          to="/owner"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Settings
        </Link>

        <div className="mt-2 flex items-center gap-2">
          <Building2 className="size-6 text-primary" />
          <h1 className="text-xl font-semibold">Organisation</h1>
          {membership && <Badge variant="secondary">{membership.orgName}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your shop&apos;s identity — used on every tax invoice, and required to compute CGST/SGST
          vs IGST at billing time.
        </p>

        {/* Form remounts (fresh defaults) whenever a different shop loads. */}
        {shop ? (
          <ShopEditor key={shop.id} shop={shop} />
        ) : (
          <p className="mt-6 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
            No shop is set up for your organisation yet. The multi-shop migration may not be
            applied; until a primary shop row exists, sales and purchases can&apos;t be saved.
          </p>
        )}
      </main>
    </div>
  );
}

function ShopEditor({ shop }: { shop: Shop }) {
  const { refresh } = useAuth();
  const [draft, setDraft] = useState<Shop>(shop);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  function edit<K extends keyof Shop>(field: K, value: Shop[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setDirty(true);
    setSavedTick(false);
  }

  async function save() {
    if (!supabase || busy) return;
    if (!draft.name?.trim()) {
      setError("Shop name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("shops")
        .update({
          name: draft.name.trim(),
          state_code: draft.state_code || null,
          gstin: draft.gstin?.trim() ? draft.gstin.trim().toUpperCase() : null,
          address: draft.address?.trim() || null,
          phone: draft.phone?.trim() || null,
          upi_vpa: draft.upi_vpa?.trim() || null,
          cutover_date: draft.cutover_date || null,
        })
        .eq("id", draft.id);
      if (err) {
        setError(err.message);
        return;
      }
      await refresh();
      setDirty(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border bg-background p-4">
      <h2 className="text-sm font-medium">Shop details</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        State is required — without it, the GST split on every invoice fails.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FormRow label="Shop name" required>
          <Input value={draft.name ?? ""} onChange={(e) => edit("name", e.target.value)} className="h-8" />
        </FormRow>
        <FormRow label="State" required>
          <select
            value={draft.state_code ?? ""}
            onChange={(e) => edit("state_code", e.target.value || null)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— select —</option>
            {INDIAN_STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          {draft.state_code && (
            <span className="text-[11px] text-muted-foreground">{stateName(draft.state_code)}</span>
          )}
        </FormRow>
        <FormRow label="GSTIN">
          <Input
            value={draft.gstin ?? ""}
            onChange={(e) => edit("gstin", e.target.value)}
            placeholder="—"
            className="h-8 font-mono text-xs uppercase"
          />
        </FormRow>
        <FormRow label="Phone">
          <Input value={draft.phone ?? ""} onChange={(e) => edit("phone", e.target.value)} placeholder="—" className="h-8" />
        </FormRow>
        <FormRow label="Address">
          <Input value={draft.address ?? ""} onChange={(e) => edit("address", e.target.value)} placeholder="—" className="h-8" />
        </FormRow>
        <FormRow label="UPI ID (VPA)" helper="Adds a pay link to payment reminders, e.g. shop@okhdfcbank.">
          <Input
            value={draft.upi_vpa ?? ""}
            onChange={(e) => edit("upi_vpa", e.target.value)}
            placeholder="—"
            className="h-8 font-mono text-xs"
          />
        </FormRow>
        <FormRow
          label="Cutover date"
          helper="Historical docs before this date are saved as non-posting (opening snapshot only)."
        >
          <Input
            type="date"
            value={draft.cutover_date ?? ""}
            onChange={(e) => edit("cutover_date", e.target.value || null)}
            className="h-8"
          />
        </FormRow>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4">
        <Button onClick={save} disabled={busy || !dirty}>
          <Save /> {busy ? "Saving…" : dirty ? "Save changes" : savedTick ? "Saved ✓" : "Saved"}
        </Button>
      </div>
    </section>
  );
}
