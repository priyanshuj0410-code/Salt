import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronDown } from "lucide-react";
import { ItemSearch } from "./ItemSearch";
import { BillTable } from "./BillTable";
import { BillSummary } from "./BillSummary";
import { ShortcutHelp } from "./ShortcutHelp";
import { CustomerPicker } from "./CustomerPicker";
import { Kbd } from "@/components/ui/kbd";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { useBill } from "@/store/bill";

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
      <span>{label}</span>
    </span>
  );
}

/**
 * The counter. Desktop (md+): a fixed-height two-pane app — search + line table
 * on the left, the running total on the right — driven entirely by the keyboard
 * (the speed benchmark; do not regress it). Below md it reflows to a single
 * scrolling column for touch: customer → search → tap-to-add lines → total → Save.
 * The brand/user live in the app shell, not here.
 */
export function BillingScreen() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const orgId = useAuth().membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const party = useBill((s) => s.party);
  const setParty = useBill((s) => s.setParty);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  useHotkeys(
    "shift+/",
    (e) => {
      e.preventDefault();
      setHelpOpen(true);
    },
    { enableOnFormTags: true },
  );

  useHotkeys(
    "mod+k",
    (e) => {
      e.preventDefault();
      setCustomerOpen(true);
    },
    { enableOnFormTags: true },
  );

  return (
    <div className="flex min-h-full flex-col bg-surface md:h-full md:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2 md:px-4 md:py-2.5">
        <div className="hidden items-baseline gap-3 md:flex">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-text-tertiary">Counter 1</span>
        </div>
        <div className="flex flex-1 items-center justify-end gap-3 text-sm md:flex-none">
          <span className="hidden text-text-tertiary sm:inline">
            Invoice <span className="font-medium text-text-primary">INV/2026-27/0042</span>
          </span>
          <button
            onClick={() => setCustomerOpen(true)}
            title="Change customer (Ctrl+K)"
            className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-border"
          >
            {party?.name ?? "Walk-in Customer"}
            <ChevronDown className="size-3 text-text-tertiary" />
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-3 p-3 md:grid md:flex-1 md:grid-cols-[1fr_320px] md:gap-4 md:overflow-hidden md:p-4">
        <div className="flex flex-col gap-3 md:min-h-0">
          <ItemSearch />
          <BillTable />
        </div>
        <BillSummary />
      </main>

      <footer className="hidden items-center gap-4 border-t border-border bg-background px-4 py-1.5 text-xs text-text-tertiary md:flex">
        <Hint keys="↑ ↓" label="navigate" />
        <Hint keys="Enter" label="add item" />
        <Hint keys="Esc" label="clear search" />
        <Hint keys="?" label="all shortcuts" />
      </footer>

      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CustomerPicker
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        orgId={orgId}
        onSelect={setParty}
      />
    </div>
  );
}
