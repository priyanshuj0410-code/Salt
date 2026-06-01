import { useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronDown, CloudOff, RefreshCw, User } from "lucide-react";
import { ItemSearch } from "./ItemSearch";
import { BillTable } from "./BillTable";
import { BillSummary } from "./BillSummary";
import { MobileCheckout } from "./MobileCheckout";
import { ShortcutHelp } from "./ShortcutHelp";
import { CustomerPicker } from "./CustomerPicker";
import { H1Gate } from "./H1Gate";
import { ParkedBills } from "./ParkedBills";
import { useCheckout } from "./useCheckout";
import { usePriceResolution } from "./usePriceResolution";
import { Kbd } from "@/components/ui/kbd";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { useBill } from "@/store/bill";
import { useHeldBills } from "@/store/heldBills";
import { useKeymap } from "@/store/shortcuts";
import { useOutbox } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import { fetchPartyCredit } from "@/lib/credit";
import { subscribeTableChanges } from "@/lib/realtime";
import { cn } from "@/lib/utils";

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Kbd>{keys}</Kbd>
      <span>{label}</span>
    </span>
  );
}

/** The prominent "who is this bill for" bar — the counter's equivalent of a
 *  delivery app's address selector. Full-width and tappable on mobile; a compact
 *  chip with a Ctrl+K hint on desktop. Opens the CustomerPicker. */
function CustomerBar({
  name,
  phone,
  onChange,
  className,
}: {
  name: string;
  phone: string | null;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onChange}
      title="Change customer (Ctrl+K)"
      className={cn(
        "flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-left hover:bg-border md:py-1.5",
        className,
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-info-bg text-info md:size-6">
        <User className="size-4 md:size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] leading-tight text-text-tertiary">Billing to</span>
        <span className="block truncate text-sm font-medium leading-tight">{name}</span>
      </span>
      {phone && <span className="shrink-0 text-xs text-text-tertiary md:hidden">{phone}</span>}
      <span className="hidden shrink-0 items-center text-text-tertiary md:flex">
        <Kbd>Ctrl K</Kbd>
      </span>
      <ChevronDown className="size-4 shrink-0 text-text-tertiary" />
    </button>
  );
}

/**
 * The counter. A fixed header (customer bar) over a scrolling content area, with
 * a persistent checkout ActionBar — the right summary pane on desktop, a
 * thumb-zone bar on mobile (`MobileCheckout`). Both are driven by one `useCheckout`
 * so the keyboard fast-path (search → Enter → F9) and the touch flow stay in sync.
 */
export function BillingScreen() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const party = useBill((s) => s.party);
  const setParty = useBill((s) => s.setParty);
  const hold = useHeldBills((s) => s.hold);
  const loadHeld = useHeldBills((s) => s.load);
  // Mount the offline outbox here (SALT-205): this drives the auto-flush on reconnect and the
  // "waiting to sync" count. The sales handler is registered in useCheckout.
  const { online, pending: pendingWrites } = useOutbox();
  // Resolve customer pricing for the bill's lines (SALT-191A) — re-prices on party change.
  usePriceResolution(shopId, party?.id ?? null);
  // Rebindable action shortcuts (SALT-178) — the counter reads keys from the keymap.
  const helpKey = useKeymap((s) => s.keymap.help);
  const customerKey = useKeymap((s) => s.keymap.customer);
  const holdKey = useKeymap((s) => s.keymap.hold);

  // Detail for the selected customer: drives the header phone, the "Add GSTIN"
  // prompt, and the intra/inter-state GST split. Refetched after a GSTIN is saved.
  const [customer, setCustomer] = useState<{
    gstin: string | null;
    phone: string | null;
    state_code: string | null;
  } | null>(null);
  const [custKey, setCustKey] = useState(0);
  // The bound party's credit limit + current dues, for the over-limit warning (SALT-004).
  const [credit, setCredit] = useState<{ creditLimitPaise: number; duePaise: number } | null>(null);
  // Gate detail on `party` so a cleared bill (after save, or walk-in) never shows
  // the previous customer's phone/GSTIN even if the fetched detail is briefly stale.
  const customerGstin = party ? (customer?.gstin ?? null) : null;
  const customerPhone = party ? (customer?.phone ?? null) : null;
  const customerState = party ? (customer?.state_code ?? null) : null;
  const customerDetail = useMemo(
    () => (party ? { gstin: customerGstin, phone: customerPhone, state_code: customerState } : null),
    [party, customerGstin, customerPhone, customerState],
  );
  const checkout = useCheckout({ customer: customerDetail, credit: party ? credit : null });

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // Held bills (SALT-191B): load this shop's set-aside bills, then keep the strip live
  // across counters — any hold/resume/discard on any device re-pulls the list.
  useEffect(() => {
    if (!shopId) return;
    void loadHeld(shopId);
    return subscribeTableChanges({
      channel: `held-${shopId}`,
      table: "held_bills",
      filter: `shop_id=eq.${shopId}`,
      event: "*",
      onChange: () => void loadHeld(shopId),
    });
  }, [shopId, loadHeld]);

  useEffect(() => {
    const id = party?.id;
    if (!supabase || !id) return;
    let active = true;
    void supabase
      .from("ledgers")
      .select("gstin,phone,state_code")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (active)
          setCustomer(
            (data as { gstin: string | null; phone: string | null; state_code: string | null } | null) ?? null,
          );
      });
    return () => {
      active = false;
    };
  }, [party?.id, custKey]);

  // Credit limit + current dues for the bound party — drives the over-limit warning (SALT-004).
  useEffect(() => {
    const id = party?.id;
    if (!supabase || !id || !orgId) return;
    let active = true;
    void fetchPartyCredit(orgId, id).then((c) => {
      if (active) setCredit(c);
    });
    return () => {
      active = false;
    };
  }, [party?.id, orgId, custKey]);

  useHotkeys(
    helpKey,
    (e) => {
      e.preventDefault();
      setHelpOpen(true);
    },
    { enableOnFormTags: true },
    [helpKey],
  );

  useHotkeys(
    customerKey,
    (e) => {
      e.preventDefault();
      setCustomerOpen(true);
    },
    { enableOnFormTags: true },
    [customerKey],
  );

  // Hold the current bill aside (Marg-style), start a fresh one.
  useHotkeys(
    holdKey,
    (e) => {
      e.preventDefault();
      if (shopId) void hold(shopId);
    },
    { enableOnFormTags: true },
    [holdKey, hold, shopId],
  );

  const refetchCustomer = () => setCustKey((k) => k + 1);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {/* Customer is the primary context, so it anchors the header (left); the
          brand lives in the sidebar, not here. */}
      <header className="flex items-center gap-3 border-b border-border bg-background px-3 py-2 md:px-4 md:py-2.5">
        <CustomerBar
          name={party?.name ?? "Walk-in customer"}
          phone={customerPhone}
          onChange={() => setCustomerOpen(true)}
          className="min-w-0 flex-1 md:w-72 md:flex-none"
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              <CloudOff className="size-3.5" /> Offline
            </span>
          )}
          {pendingWrites > 0 && (
            <span
              className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-secondary"
              title="Bills saved offline, waiting to sync"
            >
              <RefreshCw className="size-3.5" /> {pendingWrites} to sync
            </span>
          )}
          <span className="hidden text-sm text-text-tertiary md:block">Counter 1</span>
        </div>
      </header>

      <ParkedBills />

      <div className="flex-1 overflow-y-auto p-3 md:grid md:grid-cols-[1fr_320px] md:gap-4 md:overflow-hidden md:p-4">
        <div className="flex flex-col gap-3 md:min-h-0">
          <ItemSearch />
          <BillTable />
        </div>
        <BillSummary checkout={checkout} customerGstin={customerGstin} onCustomerUpdated={refetchCustomer} />
      </div>

      <MobileCheckout checkout={checkout} customerGstin={customerGstin} onCustomerUpdated={refetchCustomer} />

      <footer className="hidden items-center gap-4 border-t border-border bg-background px-4 py-1.5 text-xs text-text-tertiary md:flex">
        <Hint keys="↑ ↓" label="navigate" />
        <Hint keys="Enter" label="add item" />
        <Hint keys="F9" label="save & print" />
        <Hint keys="Esc" label="clear search" />
        <Hint keys="?" label="all shortcuts" />
      </footer>

      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <CustomerPicker
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        orgId={orgId}
        onSelect={(p) => {
          setParty(p);
          setCustomer(null);
          setCredit(null);
        }}
      />
      <ShopSetupDialog
        open={checkout.setupOpen}
        onOpenChange={checkout.setSetupOpen}
        onResolved={() => void checkout.resumeSave()}
      />
      <H1Gate
        open={checkout.rxOpen}
        onOpenChange={checkout.setRxOpen}
        lines={checkout.gatedLines}
        initial={checkout.rx}
        onConfirm={checkout.confirmRx}
      />
    </div>
  );
}
