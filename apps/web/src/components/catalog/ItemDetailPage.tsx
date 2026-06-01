import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, PencilLine, Plus, Save, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable, type Column } from "@/components/patterns/data-table";
import { ScheduleBadge, AyushBadge, ColdChainBadge } from "@/components/catalog/ScheduleBadge";
import { MessageThread } from "@/components/messages/MessageThread";
import { mrpRange } from "@/components/catalog/format";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useCatalog } from "@/store/catalog";
import { itemStock, fefoBatch } from "@/lib/search";
import { findSubstitutes, type Substitute } from "@/lib/substitutes";
import { summarizePurchasePrices, type PurchasePriceRow } from "@/lib/priceHistory";
import { formatPaise } from "@/lib/currency";
import type { Batch, Item, Schedule } from "@/lib/types";

const SCHEDULES: Schedule[] = ["OTC", "H", "H1", "X"];
const GST_RATES = [0, 5, 12, 18];
const ALIAS_KINDS = ["synonym", "brand", "salt", "barcode"] as const;
type AliasKind = (typeof ALIAS_KINDS)[number];
interface AliasRow {
  id: string;
  alias: string;
  kind: AliasKind;
}

function formFrom(i: Item) {
  return {
    name: i.name,
    salt: i.salt,
    manufacturer: i.manufacturer,
    pack: i.pack,
    hsn: i.hsn,
    gstRate: i.gstRate,
    schedule: i.schedule,
    barcode: i.barcode ?? "",
    ayush: i.ayush ?? false,
    reorderLevel: i.reorderLevel ?? 0,
    coldChain: i.coldChain ?? false,
  };
}
type Form = ReturnType<typeof formFrom>;

/**
 * Item detail + inline edit (SALT-080). Read view shows every master field, live
 * stock and the item's batches (FEFO order). Edit mode persists the master
 * fields back to `items`; batches are read-only here — they are owned by GRN /
 * inventory, so stock is never silently changed from the catalogue.
 */
export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const loading = useCatalog((s) => s.loading);
  const loaded = useCatalog((s) => s.loaded);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);
  const upsertItem = useCatalog((s) => s.upsertItem);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [aliasText, setAliasText] = useState("");
  const [aliasKind, setAliasKind] = useState<AliasKind>("synonym");
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasReload, setAliasReload] = useState(0);
  const [priceRows, setPriceRows] = useState<PurchasePriceRow[]>([]);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // Alternate names / barcodes for this item (item_aliases), for counter lookup.
  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("item_aliases")
      .select("id,alias,kind")
      .eq("org_id", orgId)
      .eq("item_id", id)
      .order("created_at")
      .then(({ data }) => {
        if (active) setAliases((data as AliasRow[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [orgId, id, aliasReload]);

  // This shop's own recent purchase (GRN) prices for the item (SALT-082, within-shop).
  useEffect(() => {
    if (!supabase || !orgId || !id) return;
    let active = true;
    supabase
      .from("purchase_lines")
      .select("mrp_paise,ptr_paise,qty,purchase:purchases(vendor_invoice_date,received_date,created_at)")
      .eq("item_id", id)
      .then(({ data }) => {
        if (!active) return;
        type Row = {
          mrp_paise: number;
          ptr_paise: number;
          qty: number;
          purchase: { vendor_invoice_date: string | null; received_date: string | null; created_at: string | null } | null;
        };
        const rows = ((data as Row[] | null) ?? []).map((r) => ({
          mrpPaise: r.mrp_paise,
          ptrPaise: r.ptr_paise,
          qty: r.qty,
          date: r.purchase?.vendor_invoice_date ?? r.purchase?.received_date ?? r.purchase?.created_at ?? "",
        }));
        setPriceRows(rows);
      });
    return () => {
      active = false;
    };
  }, [orgId, id]);

  // Leaving one item for another resets any in-progress edit. Adjusting state
  // during render on a prop change is the React-recommended pattern (not an effect).
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setEditing(false);
    setForm(null);
    setError(null);
    setAliases([]);
    setPriceRows([]);
  }

  const item = items.find((i) => i.id === id);

  if (!item) {
    return (
      <Page width="md">
        <BackLink />
        <p className="mt-8 text-sm text-text-tertiary">
          {loading && !loaded ? "Loading…" : "This item could not be found in your catalogue."}
        </p>
      </Page>
    );
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function startEdit() {
    setForm(formFrom(item!));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setForm(null);
    setError(null);
  }

  async function save() {
    if (!form || busy) return;
    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (!supabase || !orgId) {
      setError("Not connected.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const base = {
        name,
        salt: form.salt.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        pack: form.pack.trim() || null,
        hsn: form.hsn.trim() || null,
        gst_rate: form.gstRate,
        schedule: form.schedule,
        barcode: form.barcode.trim() || null,
        ayush_flag: form.ayush,
        reorder_level: form.reorderLevel,
      };
      const update = (patch: Record<string, unknown>) =>
        supabase!.from("items").update(patch).eq("id", item!.id).eq("org_id", orgId);
      // cold_chain only exists once migration 0033 is applied; if it is missing,
      // save everything else rather than failing the whole edit.
      let { error: err } = await update({ ...base, cold_chain: form.coldChain });
      let coldSaved = !err;
      if (err && /cold_chain/i.test(err.message)) {
        ({ error: err } = await update(base));
        coldSaved = false;
      }
      if (err) {
        setError(err.message);
        return;
      }
      upsertItem({
        ...item!,
        name,
        salt: form.salt.trim(),
        manufacturer: form.manufacturer.trim(),
        pack: form.pack.trim(),
        hsn: form.hsn.trim(),
        gstRate: form.gstRate,
        schedule: form.schedule,
        barcode: form.barcode.trim() || undefined,
        ayush: form.ayush,
        reorderLevel: form.reorderLevel,
        coldChain: coldSaved ? form.coldChain : (item!.coldChain ?? false),
      });
      setEditing(false);
      setForm(null);
    } finally {
      setBusy(false);
    }
  }

  async function addAlias() {
    const text = aliasText.trim();
    if (!text || aliasBusy || !supabase || !orgId || !id) return;
    setAliasBusy(true);
    const { error: err } = await supabase
      .from("item_aliases")
      .insert({ org_id: orgId, item_id: id, alias: text, kind: aliasKind });
    setAliasBusy(false);
    if (!err) {
      setAliasText("");
      setAliasReload((k) => k + 1);
    }
  }

  async function removeAlias(aliasId: string) {
    if (!supabase) return;
    await supabase.from("item_aliases").delete().eq("id", aliasId);
    setAliasReload((k) => k + 1);
  }

  const stock = itemStock(item);
  const fefo = fefoBatch(item);
  const batches = [...item.batches].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const subs = findSubstitutes(item, items);
  const prices = summarizePurchasePrices(priceRows);
  const recentBuys = [...priceRows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((r, i) => ({ ...r, key: String(i) }));

  const batchCols: Column<Batch>[] = [
    {
      key: "batch",
      header: "Batch",
      cell: (b) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs">{b.batchNo || "—"}</span>
          {fefo && b === fefo && (
            <span className="rounded-sm bg-info-bg px-1 text-[10px] font-medium text-info">FEFO</span>
          )}
        </span>
      ),
    },
    { key: "expiry", header: "Expiry", cell: (b) => b.expiry || "—" },
    {
      key: "qty",
      header: "Qty",
      numeric: true,
      cell: (b) => (b.qty > 0 ? b.qty.toLocaleString("en-IN") : <span className="text-danger">0</span>),
    },
    { key: "mrp", header: "MRP", numeric: true, cell: (b) => formatPaise(b.mrpPaise) },
    { key: "ptr", header: "PTR", numeric: true, cell: (b) => formatPaise(b.ptrPaise) },
  ];

  const subCols: Column<Substitute>[] = [
    {
      key: "name",
      header: "Item",
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-text-primary">{s.item.name}</div>
          <div className="truncate text-xs text-text-tertiary">{s.item.manufacturer || "—"}</div>
        </div>
      ),
    },
    { key: "stock", header: "Stock", numeric: true, cell: (s) => s.stock.toLocaleString("en-IN") },
    { key: "mrp", header: "MRP", numeric: true, cell: (s) => formatPaise(s.mrpPaise) },
    {
      key: "margin",
      header: "Margin",
      numeric: true,
      cell: (s) => (s.mrpPaise > 0 ? `${s.marginPct.toFixed(0)}%` : "—"),
    },
  ];

  const buyCols: Column<(typeof recentBuys)[number]>[] = [
    { key: "date", header: "Date", cell: (r) => (r.date ? r.date.slice(0, 10) : "—") },
    { key: "ptr", header: "PTR", numeric: true, cell: (r) => formatPaise(r.ptrPaise) },
    { key: "mrp", header: "MRP", numeric: true, cell: (r) => formatPaise(r.mrpPaise) },
    { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty.toLocaleString("en-IN") },
  ];

  return (
    <Page width="lg">
      <BackLink />
      <PageHeader
        icon={Tag}
        title={
          <span className="inline-flex items-center gap-2">
            {item.name}
            {item.ayush && <AyushBadge />}
            {item.coldChain && <ColdChainBadge />}
          </span>
        }
        subtitle={item.salt || (item.ayush ? "No ingredients recorded" : "No salt / molecule recorded")}
        actions={
          editing ? (
            <>
              <Button variant="outline" onClick={cancel} disabled={busy}>
                <X /> Cancel
              </Button>
              <Button onClick={save} disabled={busy || !form?.name.trim()}>
                <Save /> {busy ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button onClick={startEdit} disabled={usingSeed} title={usingSeed ? "Demo item — cannot edit" : undefined}>
              <PencilLine /> Edit
            </Button>
          )
        }
      />

      {usingSeed && (
        <p className="mb-4 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-xs text-info">
          This is a demo item. Add or import your own catalogue to edit items.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="In stock" value={stock.toLocaleString("en-IN")} tone={stock > 0 ? "default" : "danger"} />
        <StatCard label="Batches" value={item.batches.length.toLocaleString("en-IN")} />
        <StatCard label="MRP" value={mrpRange(item)} />
        <StatCard label="Next expiry" value={fefo?.expiry ?? "—"} hint={fefo ? "FEFO batch" : "no stock"} />
      </div>

      {/* Master details — read view or inline edit */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-medium text-text-primary">Details</h2>
        {editing && form ? (
          <div className="flex flex-col gap-3">
            <EditField label="Name">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} className="h-9" autoFocus />
            </EditField>
            <div className="grid gap-3 sm:grid-cols-2">
              <EditField label={form.ayush ? "Ingredients / contents" : "Salt / molecule"}>
                <Input value={form.salt} onChange={(e) => set("salt", e.target.value)} className="h-9" placeholder="—" />
              </EditField>
              <EditField label="Manufacturer">
                <Input
                  value={form.manufacturer}
                  onChange={(e) => set("manufacturer", e.target.value)}
                  className="h-9"
                  placeholder="—"
                />
              </EditField>
              <EditField label="Pack">
                <Input
                  value={form.pack}
                  onChange={(e) => set("pack", e.target.value)}
                  className="h-9"
                  placeholder="10 tab / 100 ml"
                />
              </EditField>
              <EditField label="HSN">
                <Input
                  value={form.hsn}
                  onChange={(e) => set("hsn", e.target.value)}
                  className="h-9 font-mono text-xs"
                  placeholder="—"
                />
              </EditField>
              <EditField label="Barcode">
                <Input
                  value={form.barcode}
                  onChange={(e) => set("barcode", e.target.value)}
                  className="h-9 font-mono text-xs"
                  placeholder="—"
                />
              </EditField>
              <EditField label="Reorder level">
                <Input
                  type="number"
                  min={0}
                  value={form.reorderLevel}
                  onChange={(e) => set("reorderLevel", Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="h-9"
                  placeholder="0"
                />
              </EditField>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">GST rate</span>
              <div className="flex gap-1.5">
                {GST_RATES.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    size="sm"
                    variant={form.gstRate === r ? "default" : "outline"}
                    onClick={() => set("gstRate", r)}
                  >
                    {r}%
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Schedule</span>
              <div className="flex gap-1.5">
                {SCHEDULES.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={form.schedule === s ? "default" : "outline"}
                    onClick={() => set("schedule", s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              {form.ayush && (
                <span className="text-xs text-text-tertiary">AYUSH items are non-scheduled — leave as OTC unless a schedule applies.</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Type</span>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={!form.ayush ? "default" : "outline"}
                  onClick={() => set("ayush", false)}
                >
                  Allopathic
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.ayush ? "default" : "outline"}
                  onClick={() => set("ayush", true)}
                >
                  AYUSH / non-allopathic
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">Storage</span>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={!form.coldChain ? "default" : "outline"}
                  onClick={() => set("coldChain", false)}
                >
                  Ambient
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.coldChain ? "default" : "outline"}
                  onClick={() => set("coldChain", true)}
                >
                  Cold chain
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <ViewField label={item.ayush ? "Ingredients / contents" : "Salt / molecule"} value={item.salt} />
            <ViewField label="Manufacturer" value={item.manufacturer} />
            <ViewField label="Pack" value={item.pack} />
            <ViewField label="HSN" value={item.hsn} mono />
            <ViewField label="GST rate" value={`${item.gstRate}%`} />
            <ViewField label="Schedule" value={<ScheduleBadge schedule={item.schedule} />} />
            <ViewField label="Type" value={item.ayush ? <AyushBadge /> : "Allopathic"} />
            <ViewField label="Barcode" value={item.barcode ?? ""} mono />
            <ViewField label="Reorder level" value={item.reorderLevel ? item.reorderLevel.toLocaleString("en-IN") : ""} />
            <ViewField label="Storage" value={item.coldChain ? <ColdChainBadge /> : "Ambient"} />
          </dl>
        )}
      </section>

      {/* Also known as — alternate names/barcodes (item_aliases) for counter lookup */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-primary">Also known as</h2>
          <span className="text-xs text-text-tertiary">Alternate names, brands or barcodes for counter lookup.</span>
        </div>
        {usingSeed ? (
          <p className="mt-2 text-xs text-text-tertiary">Add or import your own catalogue to manage alternate names.</p>
        ) : (
          <>
            {aliases.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {aliases.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <span className="uppercase text-text-tertiary">{a.kind}</span>
                    <span className="font-medium">{a.alias}</span>
                    <button
                      type="button"
                      onClick={() => removeAlias(a.id)}
                      aria-label={`Remove ${a.alias}`}
                      className="text-text-tertiary hover:text-danger"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-text-tertiary">No alternate names yet.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {ALIAS_KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={aliasKind === k ? "default" : "outline"}
                  onClick={() => setAliasKind(k)}
                >
                  {k}
                </Button>
              ))}
              <Input
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder="Add an alias…"
                className="h-9 max-w-[12rem]"
              />
              <Button type="button" variant="outline" disabled={aliasBusy || !aliasText.trim()} onClick={addAlias}>
                <Plus /> Add
              </Button>
            </div>
          </>
        )}
      </section>

      {/* Batches — read-only; owned by GRN / inventory */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-primary">Batches</h2>
          <span className="text-xs text-text-tertiary">Received via purchases (GRN); FEFO sells the earliest expiry first.</span>
        </div>
        <DataTable
          columns={batchCols}
          rows={batches}
          rowKey={(b) => `${b.batchNo}|${b.expiry}`}
          cols="1.2fr 0.9fr 0.6fr 0.9fr 0.9fr"
          empty={<p className="px-3 py-6 text-sm text-text-tertiary">No batches — this item has no stock yet.</p>}
        />
      </section>

      {/* Purchase prices — this shop's own recent GRN buys (SALT-082, within-shop) */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-primary">Purchase prices</h2>
          <span className="text-xs text-text-tertiary">From your goods receipts (GRN) — to set or check the catalogue price.</span>
        </div>
        {usingSeed ? (
          <p className="rounded-lg border border-border px-3 py-6 text-sm text-text-tertiary">
            Add or import your own catalogue to see purchase price history.
          </p>
        ) : prices.count === 0 ? (
          <p className="rounded-lg border border-border px-3 py-6 text-sm text-text-tertiary">
            No purchases recorded for this item yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Last PTR"
                value={prices.latest ? formatPaise(prices.latest.ptrPaise) : "—"}
                hint={prices.latest?.date ? prices.latest.date.slice(0, 10) : undefined}
              />
              <StatCard label="Last MRP" value={prices.latest ? formatPaise(prices.latest.mrpPaise) : "—"} />
              <StatCard
                label="Median PTR"
                value={formatPaise(prices.medianPtrPaise)}
                hint={`${prices.count} buy${prices.count > 1 ? "s" : ""}`}
              />
              <StatCard label="Median MRP" value={formatPaise(prices.medianMrpPaise)} />
            </div>
            <div className="mt-3">
              <DataTable
                columns={buyCols}
                rows={recentBuys}
                rowKey={(r) => r.key}
                cols="1.2fr 0.9fr 0.9fr 0.6fr"
              />
            </div>
          </>
        )}
      </section>

      {/* Substitutes — same salt, in stock, ranked by margin then velocity (SALT-083) */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-primary">Substitutes</h2>
          <span className="text-xs text-text-tertiary">
            {stock > 0 ? "Same salt, in stock — by margin" : "Out of stock — sell one of these instead"}
          </span>
        </div>
        {!item.salt.trim() ? (
          <p className="rounded-lg border border-border px-3 py-6 text-sm text-text-tertiary">
            Add a salt / molecule to this item to find substitutes.
          </p>
        ) : (
          <DataTable
            columns={subCols}
            rows={subs}
            rowKey={(s) => s.item.id}
            cols="minmax(0,1.8fr) 0.7fr 0.9fr 0.8fr"
            onRowActivate={(s) => navigate(`/catalogue/${s.item.id}`)}
            empty={
              <p className="px-3 py-6 text-sm text-text-tertiary">
                No other in-stock brand of {item.salt}.
              </p>
            }
          />
        )}
      </section>

      {/* Internal team notes for this item (SALT-162), live across counters */}
      <section className="mt-6 rounded-lg border border-border p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-primary">Notes</h2>
          <span className="text-xs text-text-tertiary">Internal team messages about this item — synced across counters.</span>
        </div>
        <MessageThread entityType="item" entityId={item.id} />
      </section>
    </Page>
  );
}

function BackLink() {
  return (
    <Link
      to="/catalogue"
      className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
    >
      <ArrowLeft className="size-4" /> Catalogue
    </Link>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-tertiary">{label}</span>
      {children}
    </label>
  );
}

function ViewField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const empty = value === "" || value == null;
  return (
    <div>
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className={mono && !empty ? "mt-0.5 font-mono text-sm text-text-primary" : "mt-0.5 text-sm text-text-primary"}>
        {empty ? <span className="text-text-tertiary">—</span> : value}
      </dd>
    </div>
  );
}
