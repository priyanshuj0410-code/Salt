import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteSalesman, saveSalesman, type SalesmanDraft } from "@/lib/salesmen";

/**
 * Add / edit a salesman. Shared by the master list and the detail page (same
 * dialog body). Mirrors the DrugLicenses form: validate, save, arm-then-confirm
 * delete. Commission is a percent of net sales — see lib/salesmen.ts.
 */
export function SalesmanForm({
  initial,
  orgId,
  onDone,
  onCancel,
}: {
  initial: SalesmanDraft;
  orgId: string | undefined;
  /** `deleted` is true when the salesman was removed (vs created/updated). */
  onDone: (deleted?: boolean) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SalesmanDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const isEdit = Boolean(initial.id);

  function edit<K extends keyof SalesmanDraft>(field: K, value: SalesmanDraft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setError(null);
  }

  async function save() {
    if (busy || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      await saveSalesman(orgId, draft);
      onDone(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSalesman(draft.id);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit salesman" : "Add salesman"}</DialogTitle>
        <DialogDescription>
          Field salesmen take orders from retailers and collect payment. Commission is a percent of
          their net sales (GST-exclusive value).
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={draft.name} onChange={(e) => edit("name", e.target.value)} placeholder="e.g. Ramesh Kumar" />
        </Field>
        <Field label="Mobile">
          <Input
            value={draft.phone}
            onChange={(e) => edit("phone", e.target.value)}
            placeholder="-"
            className="font-mono text-xs"
            inputMode="tel"
          />
        </Field>
        <Field label="Territory" hint="Area / route the salesman covers.">
          <Input value={draft.territory} onChange={(e) => edit("territory", e.target.value)} placeholder="e.g. North zone" />
        </Field>
        <Field label="Commission %" hint="Of net (ex-GST) sales.">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={draft.commission_pct}
            onChange={(e) => edit("commission_pct", e.target.value)}
            placeholder="0"
            className="tabular-nums"
          />
        </Field>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => edit("is_active", e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          <span className="text-sm">Active</span>
          <span className="text-[11px] text-muted-foreground">Inactive salesmen are kept for history but hidden from pickers.</span>
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="sm:justify-between">
        {isEdit ? (
          <Button variant="danger" onClick={() => (armDelete ? void remove() : setArmDelete(true))} disabled={busy}>
            <Trash2 /> {armDelete ? "Confirm delete" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add salesman"}
          </Button>
        </div>
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
