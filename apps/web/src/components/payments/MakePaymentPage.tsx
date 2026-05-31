import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Wallet, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { formatPaise } from "@/lib/currency";
import { TimeoutError } from "@/lib/orders";
import {
  PAYMENT_MODES,
  buildRecordPaymentArgs,
  recordPayment,
  autoAllocate,
  allocatedTotal,
  type PaymentMode,
  type OpenDoc,
  type PaymentAllocationInput,
} from "@/lib/payments";

interface VendorLite {
  id: string;
  name: string;
  type: string;
}

interface PurchaseRow {
  id: string;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  received_date: string | null;
  total_paise: number;
  paid_paise: number;
  status: string;
  posts_effects: boolean | null;
  created_at: string;
}

const toPaise = (s: string) => Math.round((Number(s) || 0) * 100);

export function MakePaymentPage() {
  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const navigate = useNavigate();

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cheque");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load this org's vendors once for the picker.
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    selectAll<VendorLite>((from, to) =>
      supabase!
        .from("ledgers")
        .select("id,name,type")
        .eq("org_id", orgId)
        .eq("type", "vendor")
        .order("name")
        .range(from, to),
    )
      .then((rows) => {
        if (active) setVendors(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId]);

  // Load the selected vendor's open purchase invoices. Outstanding is derived:
  // total − paid_paise − already-allocated (record_payment does not move paid_paise).
  useEffect(() => {
    if (!supabase || !orgId || !vendorId) return;
    let active = true;
    (async () => {
      const purchases = await selectAll<PurchaseRow>((from, to) =>
        supabase!
          .from("purchases")
          .select(
            "id,vendor_invoice_no,vendor_invoice_date,received_date,total_paise,paid_paise,status,posts_effects,created_at",
          )
          .eq("org_id", orgId)
          .eq("vendor_id", vendorId)
          .neq("status", "cancelled")
          .range(from, to),
      );
      // Imported pre-cutover purchases (posts_effects=false) are already in the
      // opening balance — exclude them from live payable invoices.
      const live = purchases.filter((p) => p.posts_effects !== false);
      const ids = live.map((p) => p.id);
      const allocatedByDoc: Record<string, number> = {};
      if (ids.length) {
        const rows = await selectAll<{ target_id: string; allocated_paise: number }>((from, to) =>
          supabase!
            .from("payment_allocations")
            .select("target_id,allocated_paise")
            .eq("org_id", orgId)
            .eq("target_table", "purchase")
            .in("target_id", ids)
            .range(from, to),
        );
        for (const r of rows) allocatedByDoc[r.target_id] = (allocatedByDoc[r.target_id] ?? 0) + r.allocated_paise;
      }
      const open: OpenDoc[] = live
        .map((p) => ({
          target_table: "purchase" as const,
          target_id: p.id,
          ref: p.vendor_invoice_no,
          doc_date: p.vendor_invoice_date ?? p.received_date ?? p.created_at.slice(0, 10),
          outstanding_paise: p.total_paise - p.paid_paise - (allocatedByDoc[p.id] ?? 0),
        }))
        .filter((d) => d.outstanding_paise > 0)
        .sort((a, b) => (a.doc_date ?? "").localeCompare(b.doc_date ?? ""));
      if (active) setDocs(open);
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : "Failed to load invoices");
    });
    return () => {
      active = false;
    };
  }, [orgId, vendorId]);

  const vendor = useMemo(() => vendors.find((v) => v.id === vendorId) ?? null, [vendors, vendorId]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return vendors.filter((v) => v.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [vendors, query]);

  const totalOutstanding = useMemo(() => docs.reduce((s, d) => s + d.outstanding_paise, 0), [docs]);
  const amountPaise = toPaise(amount);
  const allocated = allocatedTotal(alloc);
  const unallocated = amountPaise - allocated;
  const modeMeta = PAYMENT_MODES.find((m) => m.value === mode)!;

  function pickVendor(v: VendorLite) {
    setVendorId(v.id);
    setQuery("");
    setDocs([]);
    setAlloc({});
    setAmount("");
    setReference("");
    setError(null);
  }

  function clearVendor() {
    setVendorId(null);
    setDocs([]);
    setAlloc({});
    setAmount("");
  }

  // Auto-allocate oldest-first as the amount changes (event handler — keeps the
  // react-hooks/set-state-in-effect rule happy; per-row edits override below).
  function onAmount(v: string) {
    setAmount(v);
    setAlloc(autoAllocate(toPaise(v), docs));
  }

  function setRowAlloc(docId: string, value: string, max: number) {
    const paise = Math.min(Math.max(0, toPaise(value)), max);
    setAlloc((m) => ({ ...m, [docId]: paise }));
  }

  async function submit() {
    if (!shopId || !vendorId || busy) return;
    if (amountPaise <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (allocated > amountPaise) {
      setError("Allocated more than the payment amount — reduce a row or raise the amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const allocations: PaymentAllocationInput[] = docs
        .filter((d) => (alloc[d.target_id] ?? 0) > 0)
        .map((d) => ({ target_table: "purchase", target_id: d.target_id, allocated_paise: alloc[d.target_id] }));
      await recordPayment(
        buildRecordPaymentArgs({
          shopId,
          partyId: vendorId,
          direction: "paid",
          mode,
          amountPaise,
          reference,
          notes,
          allocations,
        }),
      );
      navigate(`/parties/${vendorId}`);
    } catch (e) {
      setError(
        e instanceof TimeoutError
          ? "Taking too long — it may have gone through. Check before retrying."
          : e instanceof Error
            ? e.message
            : "Could not record the payment. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="lg">
      <Link to="/payments" className="mb-2 inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary">
        <ArrowLeft className="size-3.5" /> Payments
      </Link>
      <PageHeader icon={Wallet} title="Make payment" subtitle="Pay a vendor and apply it across their open purchase invoices." />

      {/* Vendor */}
      {vendor ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-medium">{vendor.name}</div>
            <div className="text-xs text-text-tertiary">
              {docs.length} open invoice{docs.length === 1 ? "" : "s"} · {formatPaise(totalOutstanding)} outstanding
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearVendor}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor…"
            className="h-9 max-w-sm"
          />
          {matches.length > 0 && (
            <div className="max-w-sm overflow-hidden rounded-md border border-border">
              {matches.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => pickVendor(v)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  <span className="min-w-0 truncate font-medium">{v.name}</span>
                  <Badge variant="neutral" className="shrink-0 capitalize">
                    {v.type}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {vendor && (
        <>
          {/* Payment details */}
          <section className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Amount (₹)">
              <Input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
                placeholder="0"
                className="h-9 text-right tabular-nums"
              />
            </Field>
            <Field label={`${modeMeta.refLabel} (optional)`}>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={modeMeta.refLabel}
                className="h-9"
              />
            </Field>
            <div className="flex flex-col gap-1 sm:col-span-2">
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
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="—" className="h-9" />
            </Field>
          </section>

          {/* Allocation summary */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Outstanding" value={formatPaise(totalOutstanding)} />
            <StatCard label="Paying" value={formatPaise(amountPaise)} />
            <StatCard label="Allocated" value={formatPaise(allocated)} tone={allocated > amountPaise ? "danger" : "default"} />
            <StatCard
              label={unallocated >= 0 ? "On account" : "Over-allocated"}
              value={formatPaise(Math.abs(unallocated))}
              tone={unallocated < 0 ? "danger" : "default"}
            />
          </div>

          {/* Open invoices */}
          <section className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-text-primary">Open invoices</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={amountPaise <= 0 || docs.length === 0}
                onClick={() => setAlloc(autoAllocate(amountPaise, docs))}
              >
                <Wand2 /> Auto-allocate oldest first
              </Button>
            </div>
            {docs.length === 0 ? (
              <p className="rounded-lg border border-border px-3 py-6 text-sm text-text-tertiary">
                No open invoices for this vendor. You can still record an on-account payment.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="hidden grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr] gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase sm:grid">
                  <span>Invoice</span>
                  <span className="text-right">Outstanding</span>
                  <span className="text-right">Allocate ₹</span>
                  <span className="text-right">Remaining</span>
                </div>
                <div className="divide-y divide-divider">
                  {docs.map((d) => {
                    const a = alloc[d.target_id] ?? 0;
                    return (
                      <div
                        key={d.target_id}
                        className="grid grid-cols-2 items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[1.2fr_0.9fr_0.9fr_0.9fr]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{d.ref || "(no invoice no.)"}</div>
                          <div className="text-xs text-text-tertiary">
                            {d.doc_date ? format(new Date(d.doc_date), "d MMM yyyy") : "—"}
                          </div>
                        </div>
                        <div className="text-right tabular-nums sm:block">
                          <span className="text-xs text-text-tertiary sm:hidden">Outstanding </span>
                          {formatPaise(d.outstanding_paise)}
                        </div>
                        <div className="text-right">
                          <Input
                            type="number"
                            min={0}
                            value={a ? a / 100 : ""}
                            onChange={(e) => setRowAlloc(d.target_id, e.target.value, d.outstanding_paise)}
                            placeholder="0"
                            className="h-8 text-right tabular-nums"
                          />
                        </div>
                        <div className="text-right text-xs text-text-tertiary tabular-nums sm:block">
                          <span className="sm:hidden">Remaining </span>
                          {formatPaise(d.outstanding_paise - a)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {!shopId && <p className="mt-4 text-xs text-warning">No shop selected — pick a shop before recording.</p>}
          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
          <div className="mt-5">
            <Button onClick={submit} disabled={busy || !shopId || amountPaise <= 0 || allocated > amountPaise}>
              <Wallet /> {busy ? "Recording…" : `Pay ${formatPaise(amountPaise)}`}
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}
