import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRow } from "@/components/patterns/form-row";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { useAuth, type Shop } from "@/lib/auth";
import { INDIAN_STATE_CODES } from "@/lib/stateCodes";

const selectCls =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Just-in-time form that pops when the user tries to save a sale/purchase but
 * the shop is missing fields the RPCs need. Fills `state_code` (hard blocker)
 * and `gstin` (D&C Rules; soft). On success refreshes auth so `useAuth.shop`
 * reflects the new values, then fires `onResolved` so the caller can retry the
 * original save. Renders as a bottom sheet on mobile, a dialog on desktop.
 */
export function ShopSetupDialog({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onResolved?: () => void;
}) {
  const { shop } = useAuth();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Set up your shop to save bills</SheetTitle>
          <SheetDescription>
            We need your shop&apos;s state (and GSTIN if you have one) before invoices can be
            created — they decide CGST / SGST vs IGST and the tax-invoice header. You only do this
            once.
          </SheetDescription>
        </SheetHeader>

        {/* The form is keyed on shop.id so it re-mounts with fresh defaults whenever
            a different shop loads — no sync effect, no cascading-render lint. */}
        {shop ? (
          <RescueForm
            key={shop.id}
            shop={shop}
            onSaved={() => {
              onOpenChange(false);
              onResolved?.();
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              No shop is set up for your organisation yet. Set one up from{" "}
              <Link to="/settings/organisation" className="font-medium text-primary hover:underline">
                Settings → Organisation
              </Link>
              .
            </p>
            <SheetFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RescueForm({
  shop,
  onSaved,
  onCancel,
}: {
  shop: Shop;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { refresh } = useAuth();
  const [stateCode, setStateCode] = useState(shop.state_code ?? "");
  const [gstin, setGstin] = useState(shop.gstin ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!supabase || busy) return;
    if (!stateCode) {
      setError("Pick the state your shop is registered in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("shops")
        .update({
          state_code: stateCode,
          gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
        })
        .eq("id", shop.id);
      if (err) {
        setError(err.message);
        return;
      }
      await refresh();
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid gap-3">
        <div className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-tertiary">
          Editing <span className="font-medium text-text-primary">{shop.name}</span>
        </div>
        <FormRow label="State" required error={error ?? undefined}>
          <select value={stateCode} onChange={(e) => setStateCode(e.target.value)} className={selectCls}>
            <option value="">— select —</option>
            {INDIAN_STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="GSTIN" helper="Printed on invoices — recommended">
          <Input
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="—"
            className="h-9 font-mono text-xs uppercase"
          />
        </FormRow>
      </div>

      <SheetFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save & continue"}
        </Button>
      </SheetFooter>
    </>
  );
}
