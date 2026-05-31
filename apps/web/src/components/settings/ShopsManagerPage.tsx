import { useEffect, useState } from "react";
import { Building2, Check, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { INDIAN_STATE_CODES, stateName } from "@/lib/stateCodes";

interface ShopRow {
  id: string;
  name: string;
  state_code: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  upi_vpa: string | null;
  cutover_date: string | null;
  is_primary: boolean;
}

const SELECT = "id,name,state_code,gstin,address,phone,upi_vpa,cutover_date,is_primary";

interface Draft {
  id?: string;
  name: string;
  state_code: string;
  gstin: string;
  address: string;
  phone: string;
  upi_vpa: string;
  cutover_date: string;
}

const BLANK: Draft = { name: "", state_code: "", gstin: "", address: "", phone: "", upi_vpa: "", cutover_date: "" };

const toDraft = (s: ShopRow): Draft => ({
  id: s.id,
  name: s.name,
  state_code: s.state_code ?? "",
  gstin: s.gstin ?? "",
  address: s.address ?? "",
  phone: s.phone ?? "",
  upi_vpa: s.upi_vpa ?? "",
  cutover_date: s.cutover_date ?? "",
});

/** Settings → Shops. Manage every shop in the org and switch the active (primary) one. */
export function ShopsManagerPage() {
  const { membership, refresh } = useAuth();
  const orgId = membership?.orgId;
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("shops")
      .select(SELECT)
      .eq("org_id", orgId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        setRows((data as ShopRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  async function makePrimary(id: string) {
    if (!supabase || !orgId || switching) return;
    setSwitching(id);
    try {
      // Unset the rest first, then promote — there is a unique-primary-per-org index.
      await supabase.from("shops").update({ is_primary: false }).eq("org_id", orgId).neq("id", id);
      await supabase.from("shops").update({ is_primary: true }).eq("id", id);
      await refresh();
      setReloadKey((k) => k + 1);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={Building2}
        title="Shops"
        subtitle="Manage each shop's tax identity and switch the active one."
        actions={
          <Button onClick={() => setEditing(BLANK)} disabled={!orgId}>
            <Plus /> Add shop
          </Button>
        }
      />

      <p className="mb-4 text-sm text-text-secondary">
        The <span className="font-medium text-text-primary">primary</span> shop is the one Salt bills
        and reports as right now. Making another shop primary switches the active shop across the app.
      </p>

      {loading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
          No shops yet. Add one to start billing.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <div
              key={s.id}
              className={cn(
                "rounded-lg border bg-background p-4",
                s.is_primary ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.is_primary && (
                      <Badge variant="success">
                        <Star className="size-3" /> Primary
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    {s.state_code ? `${s.state_code} · ${stateName(s.state_code)}` : "No state set"}
                    {s.gstin ? ` · GSTIN ${s.gstin}` : " · No GSTIN"}
                    {s.phone ? ` · ${s.phone}` : ""}
                  </div>
                  {s.address && <div className="mt-0.5 text-xs text-text-tertiary">{s.address}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!s.is_primary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => makePrimary(s.id)}
                      disabled={!!switching}
                    >
                      {switching === s.id ? "Switching…" : "Make primary"}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(toDraft(s))}>
                    Edit
                  </Button>
                </div>
              </div>
              {!s.state_code && (
                <p className="mt-2 text-xs text-warning">
                  Set the state — without it, the GST split on this shop's invoices fails.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <ShopForm
              key={editing.id ?? "new"}
              initial={editing}
              orgId={orgId}
              onDone={async () => {
                setEditing(null);
                await refresh();
                setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ShopForm({
  initial,
  orgId,
  onDone,
  onCancel,
}: {
  initial: Draft;
  orgId: string | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(initial.id);

  function edit<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setError(null);
  }

  async function save() {
    if (!supabase || busy) return;
    if (!draft.name.trim()) {
      setError("Shop name is required.");
      return;
    }
    if (!draft.state_code) {
      setError("Pick the state the shop is registered in — the GST split needs it.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: draft.name.trim(),
      state_code: draft.state_code || null,
      gstin: draft.gstin.trim() ? draft.gstin.trim().toUpperCase() : null,
      address: draft.address.trim() || null,
      phone: draft.phone.trim() || null,
      upi_vpa: draft.upi_vpa.trim() || null,
      cutover_date: draft.cutover_date || null,
    };
    try {
      const { error: err } = draft.id
        ? await supabase.from("shops").update(payload).eq("id", draft.id)
        : await supabase.from("shops").insert({ ...payload, org_id: orgId, is_primary: false });
      if (err) {
        setError(err.message);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit shop" : "Add shop"}</DialogTitle>
        <DialogDescription>
          State and GSTIN drive the tax-invoice header and CGST/SGST vs IGST split.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shop name" required>
          <Input value={draft.name} onChange={(e) => edit("name", e.target.value)} />
        </Field>
        <Field label="State" required>
          <select
            value={draft.state_code}
            onChange={(e) => edit("state_code", e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">— select —</option>
            {INDIAN_STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="GSTIN">
          <Input
            value={draft.gstin}
            onChange={(e) => edit("gstin", e.target.value)}
            placeholder="—"
            className="font-mono text-xs uppercase"
          />
        </Field>
        <Field label="Phone">
          <Input value={draft.phone} onChange={(e) => edit("phone", e.target.value)} placeholder="—" />
        </Field>
        <Field label="Address">
          <Input value={draft.address} onChange={(e) => edit("address", e.target.value)} placeholder="—" />
        </Field>
        <Field label="UPI ID (VPA)" hint="Adds a pay link to collection reminders.">
          <Input
            value={draft.upi_vpa}
            onChange={(e) => edit("upi_vpa", e.target.value)}
            placeholder="—"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Cutover date" hint="Docs before this date load as non-posting (opening snapshot).">
          <Input type="date" value={draft.cutover_date} onChange={(e) => edit("cutover_date", e.target.value)} />
        </Field>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          <Check /> {busy ? "Saving…" : isEdit ? "Save changes" : "Add shop"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
