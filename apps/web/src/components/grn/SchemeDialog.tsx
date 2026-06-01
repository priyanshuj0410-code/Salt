import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { searchCatalog } from "@/lib/search";
import { useCatalog } from "@/store/catalog";
import type { DiscountType } from "@/lib/types";
import { VendorPicker, type PickedVendor } from "./VendorPicker";

/** A vendor_schemes row (snake_case) as fetched / inserted. */
export interface SchemeRow {
  id: string;
  vendor_id: string;
  item_id: string | null;
  label: string | null;
  discount_type: DiscountType | null;
  discount_value: number;
  scheme_buy_qty: number;
  scheme_free_qty: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
}

const toPaise = (rupees: string) => Math.round((Number(rupees) || 0) * 100);

/**
 * Create or edit a vendor scheme. Mirrors CreatePartyDialog (direct insert/update,
 * org-scoped, client-side id). A scheme carries a trade discount (pct of gross or
 * flat paise) and/or a free-goods ratio (buy N get M), optionally per-item and
 * time-boxed. `editing` non-null switches to update + exposes the active toggle.
 */
export function SchemeDialog({
  open,
  onOpenChange,
  orgId,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  editing: SchemeRow | null;
  onSaved: () => void;
}) {
  const items = useCatalog((s) => s.items);
  const userId = useAuth().user?.id ?? null;

  const editingVendorName = useMemo(() => {
    if (!editing) return null;
    return null; // resolved lazily via picker; label shows id-free fallback
  }, [editing]);

  const [vendor, setVendor] = useState<PickedVendor | null>(
    editing ? { id: editing.vendor_id, name: editingVendorName ?? "Selected vendor", stateCode: null } : null,
  );
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [itemId, setItemId] = useState<string | null>(editing?.item_id ?? null);
  const [itemQuery, setItemQuery] = useState("");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [discountType, setDiscountType] = useState<DiscountType | "">(editing?.discount_type ?? "");
  const [discountValue, setDiscountValue] = useState(
    editing
      ? editing.discount_type === "flat"
        ? String((editing.discount_value || 0) / 100)
        : String(editing.discount_value || "")
      : "",
  );
  const [buyQty, setBuyQty] = useState(String(editing?.scheme_buy_qty || ""));
  const [freeQty, setFreeQty] = useState(String(editing?.scheme_free_qty || ""));
  const [validFrom, setValidFrom] = useState(editing?.valid_from ?? "");
  const [validTo, setValidTo] = useState(editing?.valid_to ?? "");
  const [active, setActive] = useState(editing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemName = useMemo(() => items.find((i) => i.id === itemId)?.name ?? null, [items, itemId]);
  const itemResults = useMemo(
    () => (itemQuery ? searchCatalog(itemQuery, items).slice(0, 6) : []),
    [itemQuery, items],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!supabase || !orgId) {
      setError("Not connected.");
      return;
    }
    if (!vendor) {
      setError("Choose a vendor.");
      return;
    }
    const dValue = discountType === "flat" ? toPaise(discountValue) : Math.max(0, Number(discountValue) || 0);
    const payload = {
      org_id: orgId,
      vendor_id: vendor.id,
      item_id: itemId,
      label: label.trim() || null,
      discount_type: discountType || null,
      discount_value: discountType ? dValue : 0,
      scheme_buy_qty: Math.max(0, Math.floor(Number(buyQty) || 0)),
      scheme_free_qty: Math.max(0, Math.floor(Number(freeQty) || 0)),
      valid_from: validFrom || null,
      valid_to: validTo || null,
      active,
    };
    setBusy(true);
    setError(null);
    try {
      const res = editing
        ? await supabase.from("vendor_schemes").update(payload).eq("id", editing.id)
        : await supabase.from("vendor_schemes").insert({ id: crypto.randomUUID(), created_by: userId, ...payload });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit scheme" : "New vendor scheme"}</DialogTitle>
          <DialogDescription>A standing deal: trade discount and/or free goods, optionally per-item and time-boxed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Vendor">
            <button
              type="button"
              onClick={() => setVendorPickerOpen(true)}
              className="flex h-9 items-center justify-between rounded-md border border-input bg-background px-2.5 text-left text-sm hover:bg-surface"
            >
              <span className={vendor ? "" : "text-text-tertiary"}>{vendor?.name ?? "Choose vendor…"}</span>
            </button>
          </Field>

          <Field label="Applies to">
            {itemId ? (
              <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-sm">
                <span className="truncate">{itemName ?? "Selected item"}</span>
                <button type="button" className="text-xs text-text-tertiary hover:text-destructive" onClick={() => setItemId(null)}>
                  clear (all items)
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="All items — or search to scope to one"
                  className="h-9"
                />
                {itemResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                    {itemResults.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          setItemId(it.id);
                          setItemQuery("");
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-surface"
                      >
                        {it.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          <Field label="Label (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Diwali 2% CD" className="h-9" />
          </Field>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Trade discount</span>
            <div className="flex items-center gap-1.5">
              <Button type="button" size="sm" variant={discountType === "" ? "default" : "outline"} onClick={() => setDiscountType("")}>
                None
              </Button>
              <Button type="button" size="sm" variant={discountType === "pct" ? "default" : "outline"} onClick={() => setDiscountType("pct")}>
                %
              </Button>
              <Button type="button" size="sm" variant={discountType === "flat" ? "default" : "outline"} onClick={() => setDiscountType("flat")}>
                ₹ flat
              </Button>
              {discountType && (
                <Input
                  type="number"
                  min={0}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === "pct" ? "%" : "₹"}
                  className="h-8 w-24 text-right tabular-nums"
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Free goods (buy / free)</span>
            <div className="flex items-center gap-1.5">
              <Input type="number" min={0} value={buyQty} onChange={(e) => setBuyQty(e.target.value)} placeholder="buy" className="h-9 w-20 text-right tabular-nums" />
              <span className="text-text-tertiary">+</span>
              <Input type="number" min={0} value={freeQty} onChange={(e) => setFreeQty(e.target.value)} placeholder="free" className="h-9 w-20 text-right tabular-nums" />
              <span className="text-xs text-text-tertiary">e.g. 10 + 1</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from">
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-9" />
            </Field>
            <Field label="Valid to">
              <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="h-9" />
            </Field>
          </div>

          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active
            </label>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !vendor}>
            <Tag /> {busy ? "Saving…" : editing ? "Save scheme" : "Add scheme"}
          </Button>
        </form>
      </DialogContent>

      <VendorPicker open={vendorPickerOpen} onOpenChange={setVendorPickerOpen} orgId={orgId} onSelect={setVendor} />
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
