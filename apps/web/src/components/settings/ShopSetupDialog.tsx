import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth, type Shop } from "@/lib/auth";
import { INDIAN_STATE_CODES } from "@/lib/stateCodes";

/**
 * Just-in-time form that pops when the user tries to save a sale/purchase but
 * the shop is missing fields the RPCs need. Fills `state_code` (hard blocker)
 * and `gstin` (D&C Rules; soft). On success refreshes auth so `useAuth.shop`
 * reflects the new values, then fires `onResolved` so the caller can retry the
 * original save.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up your shop to save bills</DialogTitle>
          <DialogDescription>
            We need your shop&apos;s state (and GSTIN if you have one) before invoices can be
            created — they decide CGST / SGST vs IGST and the tax-invoice header. You only do
            this once.
          </DialogDescription>
        </DialogHeader>

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
            <p className="text-sm text-muted-foreground">
              No shop is set up for your organisation yet. Set one up from{" "}
              <Link to="/settings/organisation" className="font-medium text-primary hover:underline">
                Settings → Organisation
              </Link>
              .
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Editing <span className="font-medium text-foreground">{shop.name}</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            State <span className="text-destructive">*</span>
          </span>
          <select
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <option value="">— select —</option>
            {INDIAN_STATE_CODES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            GSTIN
            <span className="ml-2 font-normal italic text-muted-foreground/80">
              (printed on invoices — recommended)
            </span>
          </span>
          <Input
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="—"
            className="h-9 font-mono text-xs uppercase"
          />
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Not now
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save & continue"}
        </Button>
      </DialogFooter>
    </>
  );
}
