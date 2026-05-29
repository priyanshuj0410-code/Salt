import { useEffect, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronDown } from "lucide-react";
import { ItemSearch } from "./ItemSearch";
import { BillTable } from "./BillTable";
import { BillSummary } from "./BillSummary";
import { ShortcutHelp } from "./ShortcutHelp";
import { CustomerPicker } from "./CustomerPicker";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { useBill } from "@/store/bill";

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{keys}</kbd>
      <span>{label}</span>
    </span>
  );
}

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
    <div className="flex h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Counter 1</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Invoice <span className="font-medium text-foreground">INV/2026-27/0042</span>
          </span>
          <button
            onClick={() => setCustomerOpen(true)}
            title="Change customer (Ctrl+K)"
            className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/80"
          >
            {party?.name ?? "Walk-in Customer"}
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
          <UserMenu />
        </div>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_320px] gap-4 overflow-hidden p-4">
        <div className="flex min-h-0 flex-col gap-3">
          <ItemSearch />
          <BillTable />
        </div>
        <BillSummary />
      </main>

      <footer className="flex items-center gap-4 border-t bg-background px-4 py-1.5 text-xs text-muted-foreground">
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
