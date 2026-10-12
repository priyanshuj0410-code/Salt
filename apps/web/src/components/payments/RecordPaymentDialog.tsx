import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truncate } from "@/components/patterns/truncate";
import { FormRow } from "@/components/patterns/form-row";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TimeoutError } from "@/lib/orders";
import {
  buildRecordPaymentArgs,
  recordPayment,
  PAYMENT_MODES,
  type PaymentDirection,
  type PaymentMode,
} from "@/lib/payments";

/** The minimal party shape the picker needs (loaded once by the page). */
export interface PartyLite {
  id: string;
  name: string;
  type: string;
}

/** Vendors are paid (money out); customers/others are received from (money in). */
const defaultDirection = (type: string): PaymentDirection => (type === "vendor" ? "paid" : "received");

export function RecordPaymentDialog({
  open,
  onOpenChange,
  parties,
  onRecorded,
  initialPartyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parties: PartyLite[];
  onRecorded: (id: string) => void;
  initialPartyId?: string;
}) {
  const shopId = useAuth().shopId;
  const orgId = useAuth().membership?.orgId;
  const seedParty = initialPartyId ? (parties.find((p) => p.id === initialPartyId) ?? null) : null;

  const [partyId, setPartyId] = useState<string | null>(seedParty?.id ?? null);
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<PaymentDirection>(
    seedParty ? defaultDirection(seedParty.type) : "received",
  );
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [salesmen, setSalesmen] = useState<{ id: string; name: string }[]>([]);
  const [salesmanId, setSalesmanId] = useState("");

  const party = useMemo(() => parties.find((p) => p.id === partyId) ?? null, [parties, partyId]);

  // Active salesmen for the "collected by" selector on receipts (SALT-193).
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("salesmen")
      .select("id,name")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (active && data) setSalesmen(data as { id: string; name: string }[]);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  // Reset to defaults — called on close and after a successful record (event
  // handlers, never an effect, per the react-hooks/set-state-in-effect rule).
  function resetForm() {
    setPartyId(seedParty?.id ?? null);
    setQuery("");
    setMode("cash");
    setAmount("");
    setReference("");
    setNotes("");
    setSalesmanId("");
    setError(null);
    setDirection(seedParty ? defaultDirection(seedParty.type) : "received");
  }

  function handleOpenChange(v: boolean) {
    if (!v) resetForm();
    onOpenChange(v);
  }

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return parties.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [parties, query]);

  function pick(p: PartyLite) {
    setPartyId(p.id);
    setQuery("");
    setDirection(defaultDirection(p.type));
  }

  const modeMeta = PAYMENT_MODES.find((m) => m.value === mode)!;

  async function submit() {
    if (!shopId || !partyId || busy) return;
    const paise = Math.round((Number(amount) || 0) * 100);
    if (paise <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await recordPayment(
        buildRecordPaymentArgs({
          shopId,
          partyId,
          direction,
          mode,
          amountPaise: paise,
          reference,
          notes,
          salesmanId: direction === "received" ? salesmanId || undefined : undefined,
        }),
      );
      resetForm();
      onRecorded(id);
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Taking too long: it may have gone through. Check before retrying."
          : e instanceof Error
            ? e.message
            : "Could not record the payment. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Party */}
          {party ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
              <div className="min-w-0">
                <Truncate text={party.name} className="text-sm font-medium" />
                <div className="text-xs text-text-tertiary capitalize">{party.type}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPartyId(null)}>
                Change
              </Button>
            </div>
          ) : (
            <FormRow label="Party">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer or vendor…"
                className="h-9"
              />
              {matches.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-md border border-border">
                  {matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pick(p)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                    >
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <Badge variant="neutral" className="shrink-0 capitalize">
                        {p.type}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </FormRow>
          )}

          {/* Direction */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Direction</span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={direction === "received" ? "default" : "outline"}
                onClick={() => setDirection("received")}
              >
                Received (in)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={direction === "paid" ? "default" : "outline"}
                onClick={() => setDirection("paid")}
              >
                Paid (out)
              </Button>
            </div>
          </div>

          {/* Amount */}
          <FormRow label="Amount (₹)">
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="h-9 text-right tabular-nums"
            />
          </FormRow>

          {/* Mode */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Mode</span>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  size="sm"
                  variant={mode === m.value ? "default" : "outline"}
                  onClick={() => setMode(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Reference */}
          <FormRow label={`${modeMeta.refLabel} (optional)`}>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={modeMeta.refLabel}
              className="h-9"
            />
          </FormRow>

          {/* Notes */}
          <FormRow label="Notes (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="-" className="h-9" />
          </FormRow>

          {/* Collected by (salesman) — receipts only (SALT-193) */}
          {direction === "received" && salesmen.length > 0 && (
            <FormRow label="Collected by (optional)">
              <select
                value={salesmanId}
                onChange={(e) => setSalesmanId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:border-ring"
              >
                <option value="">-</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormRow>
          )}

          {!shopId && <p className="text-xs text-warning">No shop selected: pick a shop before recording.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={submit} disabled={busy || !shopId || !partyId}>
            <Wallet /> {busy ? "Recording…" : direction === "received" ? "Record receipt" : "Record payment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
