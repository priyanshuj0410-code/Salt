import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FormRow } from "@/components/patterns/form-row";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { INDIAN_STATE_CODES } from "@/lib/stateCodes";
import { CUSTOMER_GROUPS } from "@/lib/partyGroups";

export interface CreatedParty {
  id: string;
  name: string;
  type: PartyType;
}

type PartyType = "customer" | "vendor" | "other";
const TYPES: { value: PartyType; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

const blank = {
  name: "",
  type: "customer" as PartyType,
  phone: "",
  gstin: "",
  stateCode: "",
  address: "",
  group: "",
  // Rupee strings (not paise) — converted on submit.
  creditLimit: "",
  opening: "",
  // Sign of the opening balance: Dr = they owe you (+), Cr = you owe them (−).
  openingDir: "dr" as "dr" | "cr",
};

/**
 * Create a party (ledger) by hand — the path that does not go through Marg
 * import or a walk-in bill. Self-contained and reusable: billing's
 * CustomerPicker can mount this for its "add new" affordance and consume
 * `onCreated` to attach the fresh party to the open bill.
 */
export function CreatePartyDialog({
  open,
  onOpenChange,
  onCreated,
  defaultType,
  groupsEnabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (party: CreatedParty) => void;
  /** Pre-select the party kind (e.g. CustomerPicker passes "customer"). */
  defaultType?: PartyType;
  /** Show + persist the customer group (only when the customer_group column exists). */
  groupsEnabled?: boolean;
}) {
  const orgId = useAuth().membership?.orgId;
  const [form, setForm] = useState(() => ({ ...blank, type: defaultType ?? "customer" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to a clean slate on close, so the next open starts fresh — done on
  // the event rather than in an effect (no cascading renders).
  function handleOpenChange(next: boolean) {
    if (!next) {
      setForm({ ...blank, type: defaultType ?? "customer" });
      setError(null);
    }
    onOpenChange(next);
  }

  function set<K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // A GSTIN's first two digits are the GST state code — fill State from it so
  // the user does not re-enter what they just typed (only when State is blank).
  function onGstin(raw: string) {
    const gstin = raw.toUpperCase();
    setForm((f) => {
      const prefix = gstin.slice(0, 2);
      const known = INDIAN_STATE_CODES.some((s) => s.code === prefix);
      return { ...f, gstin, stateCode: !f.stateCode && known ? prefix : f.stateCode };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = form.name.trim();
    if (!name) {
      setError("Enter a party name.");
      return;
    }
    if (!supabase || !orgId) {
      setError("Not connected.");
      return;
    }
    const openingMagnitude = Math.round((Number(form.opening) || 0) * 100);
    const opening_balance_paise = form.openingDir === "dr" ? openingMagnitude : -openingMagnitude;
    const id = crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("ledgers").insert({
        id,
        org_id: orgId,
        name,
        type: form.type,
        phone: form.phone.trim() || null,
        gstin: form.gstin.trim() || null,
        address: form.address.trim() || null,
        state_code: form.stateCode || null,
        credit_limit_paise: Math.round((Number(form.creditLimit) || 0) * 100),
        opening_balance_paise,
        // Only send customer_group when the column exists (parent probed it),
        // so a pre-migration create still succeeds.
        ...(groupsEnabled ? { customer_group: form.group || null } : {}),
      });
      if (err) {
        setError(err.message);
        return;
      }
      onCreated?.({ id, name, type: form.type });
      handleOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New party</DialogTitle>
          <DialogDescription>Add a customer or vendor that is not in your imported ledgers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FormRow label="Name">
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Party name"
              className="h-9"
            />
          </FormRow>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Type</span>
            <div className="flex gap-1.5">
              {TYPES.map((t) => (
                <Button
                  key={t.value}
                  type="button"
                  size="sm"
                  variant={form.type === t.value ? "default" : "outline"}
                  onClick={() => set("type", t.value)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Phone">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="—" className="h-9" />
            </FormRow>
            <FormRow label="GSTIN">
              <Input
                value={form.gstin}
                onChange={(e) => onGstin(e.target.value)}
                placeholder="—"
                className="h-9 font-mono text-xs uppercase"
              />
            </FormRow>
            <FormRow label="State">
              <select
                value={form.stateCode}
                onChange={(e) => set("stateCode", e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:border-ring"
              >
                <option value="">—</option>
                {INDIAN_STATE_CODES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Credit limit (₹)">
              <Input
                type="number"
                min={0}
                value={form.creditLimit}
                onChange={(e) => set("creditLimit", e.target.value)}
                placeholder="0"
                className="h-9 text-right tabular-nums"
              />
            </FormRow>
            {groupsEnabled && (
              <FormRow label="Group">
                <select
                  value={form.group}
                  onChange={(e) => set("group", e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:border-ring"
                >
                  <option value="">—</option>
                  {CUSTOMER_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </FormRow>
            )}
          </div>

          <FormRow label="Address">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="—" className="h-9" />
          </FormRow>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Opening balance (₹)</span>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                value={form.opening}
                onChange={(e) => set("opening", e.target.value)}
                placeholder="0"
                className="h-9 flex-1 text-right tabular-nums"
              />
              <Button
                type="button"
                size="sm"
                variant={form.openingDir === "dr" ? "default" : "outline"}
                onClick={() => set("openingDir", "dr")}
              >
                Dr
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.openingDir === "cr" ? "default" : "outline"}
                onClick={() => set("openingDir", "cr")}
              >
                Cr
              </Button>
            </div>
            <span className="text-xs text-text-tertiary">
              {form.openingDir === "dr" ? "Dr — they owe you (receivable)" : "Cr — you owe them (payable)"}
            </span>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !form.name.trim()}>
            <UserPlus /> {busy ? "Adding…" : "Add party"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
