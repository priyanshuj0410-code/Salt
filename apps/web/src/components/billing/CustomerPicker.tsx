import { useEffect, useMemo, useState } from "react";
import { Search, User, Users } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { cacheGet, cacheKey, cachePut } from "@/lib/offline/cache";
import type { OrderParty } from "@/lib/orders";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
}

/** The full party shape cached under the shared `parties` key (matches what `PartiesPage` writes,
 *  SALT-207) so the two share one offline cache without either clobbering the other's fields. */
interface PartyRow {
  id: string;
  name: string;
  type: string;
  phone: string | null;
  gstin: string | null;
  state_code: string | null;
  opening_balance_paise: number | null;
  customer_group: string | null;
}
const PARTY_COLS = "id,name,type,phone,gstin,state_code,opening_balance_paise,customer_group";

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

  // Load the org's parties for the picker (SALT-215). Online: fetch the full party list, refresh the
  // shared `parties` cache (so a cashier can bill a known customer through an outage), and show
  // customers. Offline / on fetch failure: fall back to that cache instead of an empty list.
  useEffect(() => {
    if (!open || !orgId || loaded) return;
    let active = true;
    const key = cacheKey("parties", orgId);
    void (async () => {
      let parties: PartyRow[] | null = null;
      if (supabase && (typeof navigator === "undefined" || navigator.onLine)) {
        const { data, error } = await supabase.from("ledgers").select(PARTY_COLS).eq("org_id", orgId).order("name");
        if (!error && data) {
          parties = data as PartyRow[];
          void cachePut(key, parties);
        }
      }
      if (!parties) parties = (await cacheGet<PartyRow[]>(key))?.data ?? [];
      if (!active) return;
      setRows(parties.filter((p) => p.type === "customer").map((p) => ({ id: p.id, name: p.name, phone: p.phone })));
      setLoaded(true);
    })();
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Choose customer</SheetTitle>
        </SheetHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Keyboard fast-path: Enter picks the top match.
              if (e.key === "Enter" && filtered.length > 0) {
                e.preventDefault();
                choose({ id: filtered[0].id, name: filtered[0].name });
              }
            }}
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
              {rows.length === 0 ? "No customers yet: import or add parties first." : "No matches."}
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
      </SheetContent>
    </Sheet>
  );
}
