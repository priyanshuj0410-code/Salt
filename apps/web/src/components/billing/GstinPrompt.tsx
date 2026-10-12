import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * "Add GSTIN" for the selected customer, mid-bill (Swiggy's cart GSTIN row). Only
 * rendered when a named customer has no GSTIN on file; writes `ledgers.gstin` and
 * calls `onSaved` so the prompt disappears. Must never interrupt the sale, so it
 * is inline and dismissable, not a blocking step.
 */
export function GstinPrompt({
  partyId,
  onSaved,
  className,
}: {
  partyId: string;
  onSaved: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const g = val.trim().toUpperCase();
    if (!supabase || !g || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("ledgers").update({ gstin: g }).eq("id", partyId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOpen(false);
    setVal("");
    onSaved();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-sm hover:bg-surface",
          className,
        )}
      >
        <span className="flex items-center gap-2 text-text-secondary">
          <FileText className="size-4 text-text-tertiary" />
          Add GSTIN
          <span className="hidden text-xs text-text-tertiary sm:inline">claim GST credit</span>
        </span>
        <span className="text-xs font-medium text-primary">Add</span>
      </button>
    );
  }

  return (
    <div className={cn("rounded-md border border-border p-2", className)}>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="22ABCDE1234F1Z5"
          aria-label="Customer GSTIN"
          className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs uppercase focus-visible:border-ring"
        />
        <Button size="sm" onClick={save} disabled={busy || !val.trim()}>
          Save
        </Button>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
