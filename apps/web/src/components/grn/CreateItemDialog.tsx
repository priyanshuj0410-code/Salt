import { useState } from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { Item, Schedule } from "@/lib/types";

const SCHEDULES: Schedule[] = ["OTC", "H", "H1", "X"];
const GST_RATES = [0, 5, 12, 18];

const blank = {
  name: "",
  salt: "",
  manufacturer: "",
  pack: "",
  hsn: "",
  gstRate: 12,
  schedule: "OTC" as Schedule,
};

/**
 * Add an item to the master by hand — the GRN path for stock that arrived for a
 * product not yet in the catalogue. Deliberately explicit (no silent add at
 * receipt): the user confirms name, GST rate, HSN and schedule before it exists.
 * Mirrors CreatePartyDialog; `onCreated` hands back the full Item so the caller
 * can drop it straight onto the open GRN and into the catalog store.
 */
export function CreateItemDialog({
  open,
  onOpenChange,
  onCreated,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: Item) => void;
  /** Prefill the name (e.g. the GRN search text that matched nothing). Read once
   *  on mount — the parent mounts this only while open, so each open starts fresh. */
  defaultName?: string;
}) {
  const orgId = useAuth().membership?.orgId;
  const [form, setForm] = useState(() => ({ ...blank, name: defaultName ?? "" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = form.name.trim();
    if (!name) {
      setError("Enter an item name.");
      return;
    }
    if (!supabase || !orgId) {
      setError("Not connected.");
      return;
    }
    const id = crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("items").insert({
        id,
        org_id: orgId,
        name,
        salt: form.salt.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        pack: form.pack.trim() || null,
        hsn: form.hsn.trim() || null,
        gst_rate: form.gstRate,
        schedule: form.schedule,
      });
      if (err) {
        setError(err.message);
        return;
      }
      const item: Item = {
        id,
        name,
        salt: form.salt.trim(),
        manufacturer: form.manufacturer.trim(),
        pack: form.pack.trim(),
        hsn: form.hsn.trim(),
        gstRate: form.gstRate,
        schedule: form.schedule,
        velocity: 0,
        batches: [],
      };
      onCreated?.(item);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>Add a product to the master before receiving its stock.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Name">
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Dolo 650 Tablet"
              className="h-9"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Salt / molecule">
              <Input value={form.salt} onChange={(e) => set("salt", e.target.value)} placeholder="—" className="h-9" />
            </Field>
            <Field label="Manufacturer">
              <Input
                value={form.manufacturer}
                onChange={(e) => set("manufacturer", e.target.value)}
                placeholder="—"
                className="h-9"
              />
            </Field>
            <Field label="Pack">
              <Input
                value={form.pack}
                onChange={(e) => set("pack", e.target.value)}
                placeholder="10 tab / 100 ml"
                className="h-9"
              />
            </Field>
            <Field label="HSN">
              <Input
                value={form.hsn}
                onChange={(e) => set("hsn", e.target.value)}
                placeholder="—"
                className="h-9 font-mono text-xs"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">GST rate</span>
            <div className="flex gap-1.5">
              {GST_RATES.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={form.gstRate === r ? "default" : "outline"}
                  onClick={() => set("gstRate", r)}
                >
                  {r}%
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Schedule</span>
            <div className="flex gap-1.5">
              {SCHEDULES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={form.schedule === s ? "default" : "outline"}
                  onClick={() => set("schedule", s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !form.name.trim()}>
            <PackagePlus /> {busy ? "Adding…" : "Add item"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
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
