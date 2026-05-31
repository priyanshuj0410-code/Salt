import { useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BillLine } from "@/lib/types";
import type { RxDetails } from "@/lib/orders";
import { ScheduleBadge } from "./ScheduleBadge";

const EMPTY_RX: RxDetails = { doctorName: "", doctorRegNo: "", patientName: "", patientAddress: "" };

const fieldCls =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-text-secondary">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * The Schedule H1/X hard gate. Whenever the bill carries an H1/X drug, checkout is
 * blocked until the prescriber + patient are recorded (Drugs & Cosmetics Rules).
 * Required: doctor name, patient name, patient address — mirrors the server
 * `record_h1_entry` contract; doctor reg. no. is optional. Cancelling just leaves
 * the bill unsaved (the cashier can remove the gated item instead).
 */
export function H1Gate({
  open,
  onOpenChange,
  lines,
  initial,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: BillLine[];
  initial: RxDetails | null;
  onConfirm: (rx: RxDetails) => void;
}) {
  const [rx, setRx] = useState<RxDetails>(initial ?? EMPTY_RX);

  // Reset the form to the captured value (or blank) when the dialog opens — the
  // "adjust state during render" pattern, so no effect is needed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRx(initial ?? EMPTY_RX);
  }

  const ready = rx.doctorName.trim() && rx.patientName.trim() && rx.patientAddress.trim();

  function submit() {
    if (!ready) return;
    onConfirm({
      doctorName: rx.doctorName.trim(),
      doctorRegNo: rx.doctorRegNo.trim(),
      patientName: rx.patientName.trim(),
      patientAddress: rx.patientAddress.trim(),
    });
  }

  // Enter advances on the single-line fields (the textarea keeps Enter for newlines).
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" />
            Prescription required
          </DialogTitle>
          <DialogDescription>
            Schedule H1/X drugs must be dispensed against a prescription and logged with the
            prescriber and patient. Required by the Drugs &amp; Cosmetics Rules.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5">
          {lines.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {l.name} <span className="text-text-tertiary">× {l.qty}</span>
              </span>
              <ScheduleBadge schedule={l.schedule} />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Prescribing doctor" required>
            <input
              autoFocus
              value={rx.doctorName}
              onChange={(e) => setRx((s) => ({ ...s, doctorName: e.target.value }))}
              onKeyDown={onEnter}
              placeholder="Dr. full name"
              className={fieldCls}
            />
          </Field>
          <Field label="Doctor reg. no.">
            <input
              value={rx.doctorRegNo}
              onChange={(e) => setRx((s) => ({ ...s, doctorRegNo: e.target.value }))}
              onKeyDown={onEnter}
              placeholder="State medical council reg. (optional)"
              className={fieldCls}
            />
          </Field>
          <Field label="Patient name" required>
            <input
              value={rx.patientName}
              onChange={(e) => setRx((s) => ({ ...s, patientName: e.target.value }))}
              onKeyDown={onEnter}
              placeholder="Full name"
              className={fieldCls}
            />
          </Field>
          <Field label="Patient address" required>
            <textarea
              value={rx.patientAddress}
              onChange={(e) => setRx((s) => ({ ...s, patientAddress: e.target.value }))}
              placeholder="Address as on the prescription"
              rows={2}
              className={cn(fieldCls, "h-auto resize-none py-1.5")}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready}>
            Record &amp; continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline checkout banner that surfaces the H1/X requirement before the cashier hits
 * Save — amber until the prescription is captured, green once it is. Tapping it opens
 * the gate (to add or edit). Rendered by both checkout presentations.
 */
export function H1Notice({
  rxCaptured,
  doctorName,
  onEdit,
}: {
  rxCaptured: boolean;
  doctorName?: string;
  onEdit: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm",
        rxCaptured
          ? "border-success-border bg-success-bg text-success"
          : "border-warning-border bg-warning-bg text-warning",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {rxCaptured ? (
          <Check className="size-4 shrink-0" />
        ) : (
          <ShieldAlert className="size-4 shrink-0" />
        )}
        <span className="truncate font-medium">
          {rxCaptured
            ? `Prescription recorded${doctorName ? ` · ${doctorName}` : ""}`
            : "Schedule H1/X — prescription required"}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium underline-offset-2 hover:underline">
        {rxCaptured ? "Edit" : "Add"}
      </span>
    </button>
  );
}
