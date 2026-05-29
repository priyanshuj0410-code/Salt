import { useEffect, useMemo, useState } from "react";
import { Search, User, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { OrderParty } from "@/lib/orders";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Pick the customer a bill is for. "Walk-in" (null party) is the default and
 * always offered at the top. Lists the org's customer ledgers, searchable.
 */
export function CustomerPicker({
  open,
  onOpenChange,
  orgId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  onSelect: (party: OrderParty | null) => void;
}) {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || !supabase || !orgId || loaded) return;
    let active = true;
    supabase
      .from("ledgers")
      .select("id,name,phone")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .order("name")
      .then(({ data }) => {
        if (active) {
          setRows((data as CustomerRow[] | null) ?? []);
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

  function choose(party: OrderParty | null) {
    onSelect(party);
    onOpenChange(false);
    setQ("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose customer</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or phone…"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 overflow-auto rounded-md border">
          {/* Walk-in is always first */}
          <button
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm hover:bg-muted/60"
          >
            <Users className="size-4 text-muted-foreground" />
            <span className="font-medium">Walk-in customer</span>
            <span className="ml-auto text-xs text-muted-foreground">no account</span>
          </button>

          {!loaded ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {rows.length === 0 ? "No customers yet — import or add parties first." : "No matches."}
            </p>
          ) : (
            filtered.map((r) => (
              <button
                key={r.id}
                onClick={() => choose({ id: r.id, name: r.name })}
                className={cn(
                  "flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60",
                )}
              >
                <User className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                {r.phone && <span className="shrink-0 text-xs text-muted-foreground">{r.phone}</span>}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
