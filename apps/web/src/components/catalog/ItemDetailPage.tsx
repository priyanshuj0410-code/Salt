import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PencilLine, Save, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable, type Column } from "@/components/patterns/data-table";
import { ScheduleBadge } from "@/components/catalog/ScheduleBadge";
import { mrpRange } from "@/components/catalog/format";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useCatalog } from "@/store/catalog";
import { itemStock, fefoBatch } from "@/lib/search";
import { formatPaise } from "@/lib/currency";
import type { Batch, Item, Schedule } from "@/lib/types";

const SCHEDULES: Schedule[] = ["OTC", "H", "H1", "X"];
const GST_RATES = [0, 5, 12, 18];

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

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // Leaving one item for another resets any in-progress edit. Adjusting state
  // during render on a prop change is the React-recommended pattern (not an effect).
  const [prevId, setPrevId] = useState(id);
  if (id !== prevId) {
    setPrevId(id);
    setEditing(false);
    setForm(null);
    setError(null);
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
      const { error: err } = await supabase
        .from("items")
        .update({
          name,
          salt: form.salt.trim() || null,
          manufacturer: form.manufacturer.trim() || null,
          pack: form.pack.trim() || null,
          hsn: form.hsn.trim() || null,
          gst_rate: form.gstRate,
          schedule: form.schedule,
          barcode: form.barcode.trim() || null,
        })
        .eq("id", item!.id)
        .eq("org_id", orgId);
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
      });
      setEditing(false);
      setForm(null);
    } finally {
      setBusy(false);
    }
  }

  const stock = itemStock(item);
  const fefo = fefoBatch(item);
  const batches = [...item.batches].sort((a, b) => a.expiry.localeCompare(b.expiry));

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

  return (
    <Page width="lg">
      <BackLink />
      <PageHeader
        icon={Tag}
        title={item.name}
        subtitle={item.salt || "No salt / molecule recorded"}
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
              <EditField label="Salt / molecule">
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
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <ViewField label="Salt / molecule" value={item.salt} />
            <ViewField label="Manufacturer" value={item.manufacturer} />
            <ViewField label="Pack" value={item.pack} />
            <ViewField label="HSN" value={item.hsn} mono />
            <ViewField label="GST rate" value={`${item.gstRate}%`} />
            <ViewField label="Schedule" value={<ScheduleBadge schedule={item.schedule} />} />
            <ViewField label="Barcode" value={item.barcode ?? ""} mono />
          </dl>
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
