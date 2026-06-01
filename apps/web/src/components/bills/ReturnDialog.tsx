import { useEffect, useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import {
  buildCreditNoteLines,
  buildReturnEditorLines,
  computeReturn,
  type ReturnEditorLine,
  type SaleLineForReturn,
} from "@/lib/billReturn";

// SALT-189 — sales return against a bill, computed on the shared returns engine.
// Pick lines + qty (capped at the returnable balance); the credit note reverses
// the discounted net + outward GST via create_credit_note.

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: string;
  invoiceNo: string;
  shopId: string | null;
  partyId: string | null;
  isInterstate: boolean;
  /** Refund routing: a credit customer's receivable goes down ('credit'); a cash bill refunds cash. */
  defaultRefundMode: "cash" | "bank" | "credit";
  onDone: () => void;
}

const REFUND_MODES: { value: "cash" | "bank" | "credit"; label: string }[] = [
  { value: "cash", label: "Cash refund" },
  { value: "bank", label: "Bank refund" },
  { value: "credit", label: "Credit to account" },
];

export function ReturnDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNo,
  shopId,
  partyId,
  isInterstate,
  defaultRefundMode,
  onDone,
}: ReturnDialogProps) {
  const orgId = useAuth().membership?.orgId;
  const [editor, setEditor] = useState<ReturnEditorLine[] | null>(null);
  const [reason, setReason] = useState("");
  const [refundMode, setRefundMode] = useState<"cash" | "bank" | "credit">(defaultRefundMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      // Reset for this open (async, so it does not cascade-render within the effect).
      setEditor(null);
      setReason("");
      setRefundMode(defaultRefundMode);
      setError(null);
      if (!supabase || !orgId) return;
      // Original sale lines (taxable_paise = post-discount net = the engine basis).
      const { data: sl, error: slErr } = await supabase!
        .from("sale_lines")
        .select("id,item_id,batch_id,name,batch_no,expiry,qty,rate_paise,gst_rate,taxable_paise,line_total_paise")
        .eq("invoice_id", invoiceId)
        .order("name", { ascending: true });
      if (slErr) {
        if (active) setError(slErr.message);
        return;
      }
      const saleLines = (sl as SaleLineForReturn[] | null) ?? [];

      // Units already returned per sale_line, across PLACED credit notes — matches
      // the server-side cap in create_credit_note so the UI agrees with the RPC.
      const already = new Map<string, number>();
      const ids = saleLines.map((l) => l.id);
      if (ids.length) {
        const { data: prior } = await supabase!
          .from("credit_note_lines")
          .select("sale_line_id,qty,credit_notes!inner(status)")
          .in("sale_line_id", ids)
          .eq("credit_notes.status", "placed");
        for (const r of (prior as { sale_line_id: string | null; qty: number }[] | null) ?? []) {
          if (r.sale_line_id) already.set(r.sale_line_id, (already.get(r.sale_line_id) ?? 0) + r.qty);
        }
      }
      if (active) setEditor(buildReturnEditorLines(saleLines, already));
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : "Failed to load bill lines");
    });
    return () => {
      active = false;
    };
  }, [open, orgId, invoiceId, defaultRefundMode]);

  const computed = useMemo(
    () => (editor ? computeReturn(editor, isInterstate) : null),
    [editor, isInterstate],
  );

  function setQty(saleLineId: string, raw: string) {
    setEditor((prev) =>
      prev?.map((l) => {
        if (l.saleLineId !== saleLineId) return l;
        const n = Math.max(0, Math.min(l.returnable, Math.floor(Number(raw) || 0)));
        return { ...l, returnQty: n };
      }) ?? prev,
    );
  }

  async function submit() {
    if (!supabase || !shopId || !computed || computed.active.length === 0) return;
    if (refundMode === "credit" && !partyId) {
      setError("A walk-in bill cannot credit to an account — choose cash or bank refund.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("create_credit_note", {
      p_shop_id: shopId,
      p_party_id: partyId,
      p_sale_invoice_id: invoiceId,
      p_reason: reason.trim() || null,
      p_refund_mode: refundMode,
      p_lines: buildCreditNoteLines(computed),
    });
    setSubmitting(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    onOpenChange(false);
    onDone();
  }

  const nothingToReturn = editor != null && editor.every((l) => l.returnable === 0);
  const hasQty = !!computed && computed.active.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-4 text-text-tertiary" /> Return items · {invoiceNo}
          </DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-danger">{error}</p>}

        {editor === null ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : nothingToReturn ? (
          <p className="py-6 text-center text-sm text-text-tertiary">
            Everything on this bill has already been returned.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[1fr_5rem_4rem_6rem_6rem] gap-2 border-b border-border bg-surface px-3 py-1.5 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">
              <span>Item</span>
              <span className="text-right">Returnable</span>
              <span className="text-right">Return</span>
              <span className="text-right">GST</span>
              <span className="text-right">Refund</span>
            </div>
            {computed!.lines.map((c) => {
              const l = c.line;
              const disabled = l.returnable === 0;
              return (
                <div
                  key={l.saleLineId}
                  className="grid grid-cols-[1fr_5rem_4rem_6rem_6rem] items-center gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="min-w-0 truncate">
                    {l.name}
                    {l.batchNo && <span className="ml-1 text-xs text-text-tertiary">{l.batchNo}</span>}
                    {l.alreadyReturned > 0 && (
                      <span className="ml-1 text-xs text-text-tertiary">· {l.alreadyReturned} returned</span>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-text-tertiary">{l.returnable}</span>
                  <Input
                    type="number"
                    min={0}
                    max={l.returnable}
                    value={l.returnQty === 0 ? "" : String(l.returnQty)}
                    placeholder="0"
                    disabled={disabled}
                    onChange={(e) => setQty(l.saleLineId, e.target.value)}
                    className="h-8 text-right tabular-nums"
                  />
                  <span className="text-right tabular-nums text-text-tertiary">{formatPaise(c.gstPaise)}</span>
                  <span className="text-right tabular-nums">{formatPaise(c.totalPaise)}</span>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_auto] items-center gap-2 bg-surface px-3 py-2 text-sm">
              <span className="font-medium">Total refund</span>
              <span className="tabular-nums font-medium">{formatPaise(computed!.totalPaise)}</span>
            </div>
          </div>
        )}

        {editor !== null && !nothingToReturn && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Refund mode"
              value={refundMode}
              onChange={(e) => setRefundMode(e.target.value as "cash" | "bank" | "credit")}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {REFUND_MODES.map((m) => (
                <option key={m.value} value={m.value} disabled={m.value === "credit" && !partyId}>
                  {m.label}
                </option>
              ))}
            </select>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-8 flex-1"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !hasQty}>
            {submitting ? "Processing…" : "Create credit note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
