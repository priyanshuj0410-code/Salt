import { useEffect, useMemo, useState } from "react";
import { Search, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

export interface PickedVendor {
  id: string;
  name: string;
  /** GST state code — needed to decide inter- vs intra-state on the GRN. */
  stateCode: string | null;
}

interface VendorRow {
  id: string;
  name: string;
  phone: string | null;
  state_code: string | null;
}

/**
 * Pick the vendor a GRN is for. Lists the org's vendor ledgers, searchable.
 * Mirrors billing's CustomerPicker, minus the walk-in row (a purchase always
 * has a named vendor) and filtered to `type = vendor`.
 */
export function VendorPicker({
  open,
  onOpenChange,
  orgId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  onSelect: (vendor: PickedVendor) => void;
}) {
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || !supabase || !orgId || loaded) return;
    let active = true;
    supabase
      .from("ledgers")
      .select("id,name,phone,state_code")
      .eq("org_id", orgId)
      .eq("type", "vendor")
      .order("name")
      .then(({ data }) => {
        if (active) {
          setRows((data as VendorRow[] | null) ?? []);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [open, orgId, loaded]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.phone ?? "").includes(needle))
      : rows;
    return list.slice(0, 100);
  }, [rows, q]);

  function choose(v: VendorRow) {
    onSelect({ id: v.id, name: v.name, stateCode: v.state_code });
    onOpenChange(false);
    setQ("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose vendor</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                choose(filtered[0]);
              }
            }}
            placeholder="Search vendors by name or phone…"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 overflow-auto rounded-md border border-border">
          {!loaded ? (
            <p className="px-3 py-3 text-sm text-text-tertiary">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-tertiary">
              {rows.length === 0 ? "No vendors yet: import or add a vendor party first." : "No matches."}
            </p>
          ) : (
            filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => choose(r)}
                className="flex w-full items-center gap-2 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface"
              >
                <Truck className="size-4 text-text-tertiary" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.phone && <span className="shrink-0 text-xs text-text-tertiary">{r.phone}</span>}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
