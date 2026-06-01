import { useEffect, useMemo, useState } from "react";
import { Hash } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { currentIndianFy, seriesPreview, normalizeSeriesCode } from "@/lib/series";

const COLS = "id,code,prefix,next_number,number_width,is_default,active";

interface SeriesRow {
  id: string;
  code: string;
  prefix: string | null;
  next_number: number;
  number_width: number;
  is_default: boolean;
  active: boolean;
}

export function InvoiceSeriesPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const fy = useState(() => currentIndianFy(new Date()))[0];
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Add / edit form.
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [prefix, setPrefix] = useState("");
  const [width, setWidth] = useState(5);

  async function fetchSeries(): Promise<SeriesRow[]> {
    if (!supabase || !orgId || !shopId) return [];
    const { data } = await supabase
      .from("invoice_series")
      .select(COLS)
      .eq("org_id", orgId)
      .eq("shop_id", shopId)
      .eq("doc_type", "sales_invoice")
      .eq("financial_year", fy)
      .order("code");
    return (data as unknown as SeriesRow[] | null) ?? [];
  }
  /** Refresh after a mutation — called from event handlers, where setState is fine. */
  async function refresh() {
    setRows(await fetchSeries());
  }
  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    (async () => {
      const data = await fetchSeries();
      if (!active) return;
      setRows(data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, shopId, fy]);

  function resetForm() {
    setEditId(null);
    setCode("");
    setPrefix("");
    setWidth(5);
    setErr("");
  }
  function startEdit(r: SeriesRow) {
    setEditId(r.id);
    setCode(r.code);
    setPrefix(r.prefix ?? "");
    setWidth(r.number_width);
    setErr("");
  }

  async function save() {
    if (!supabase || !orgId || !shopId) return;
    const c = normalizeSeriesCode(code);
    if (!c) {
      setErr("Enter a series code (e.g. RETAIL, WS).");
      return;
    }
    if (!editId && rows.some((r) => r.code === c)) {
      setErr(`A series "${c}" already exists this year.`);
      return;
    }
    setBusy(true);
    setErr("");
    const w = Math.max(1, Math.min(9, Math.round(width) || 5));
    const res = editId
      ? await supabase.from("invoice_series").update({ prefix: prefix.trim() || null, number_width: w }).eq("id", editId)
      : await supabase.from("invoice_series").insert({
          org_id: orgId,
          shop_id: shopId,
          doc_type: "sales_invoice",
          code: c,
          prefix: prefix.trim() || null,
          next_number: 1,
          financial_year: fy,
          number_width: w,
          is_default: rows.length === 0,
          active: true,
        });
    setBusy(false);
    if (res.error) {
      setErr(res.error.message);
      return;
    }
    resetForm();
    await refresh();
  }

  async function makeDefault(id: string) {
    if (!supabase || !orgId || !shopId) return;
    setBusy(true);
    await supabase.from("invoice_series").update({ is_default: false }).eq("org_id", orgId).eq("shop_id", shopId).eq("doc_type", "sales_invoice").eq("financial_year", fy);
    await supabase.from("invoice_series").update({ is_default: true }).eq("id", id);
    setBusy(false);
    await refresh();
  }
  async function toggleActive(r: SeriesRow) {
    if (!supabase) return;
    setBusy(true);
    await supabase.from("invoice_series").update({ active: !r.active }).eq("id", r.id);
    setBusy(false);
    await refresh();
  }

  const subtitle = useMemo(
    () => (
      <span>
        {shop?.name ?? "This shop"} · FY <span className="tabular-nums">{fy}</span> · sales invoice numbering
      </span>
    ),
    [shop?.name, fy],
  );

  if (!authLoading && !shopId) {
    return (
      <Page width="md">
        <PageHeader icon={Hash} title="Invoice series" subtitle={subtitle} />
        <EmptyState title="No shop selected" hint="Numbering series are per shop. Pick a shop to continue." />
      </Page>
    );
  }

  return (
    <Page width="md">
      <PageHeader icon={Hash} title="Invoice series" subtitle={subtitle} />

      <DataTable<SeriesRow>
        cols="1fr 1.6fr 0.7fr 0.7fr 1.7fr"
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty="No series yet — a DEFAULT one is created on the first bill, or add one below."
        columns={[
          {
            key: "code",
            header: "Series",
            cell: (r) => (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {r.code}
                {r.is_default && <Badge variant="secondary">default</Badge>}
                {!r.active && <Badge variant="neutral">inactive</Badge>}
              </span>
            ),
          },
          { key: "preview", header: "Next number", cell: (r) => <span className="tabular-nums">{seriesPreview(r.prefix ?? "", fy, r.number_width, r.next_number)}</span> },
          { key: "prefix", header: "Prefix", cell: (r) => r.prefix || "—" },
          { key: "width", header: "Width", numeric: true, cell: (r) => r.number_width },
          {
            key: "actions",
            header: "",
            cell: (r) => (
              <span className="flex justify-end gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => startEdit(r)} disabled={busy}>
                  Edit
                </Button>
                {!r.is_default && (
                  <Button size="xs" variant="ghost" onClick={() => makeDefault(r.id)} disabled={busy}>
                    Make default
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={() => toggleActive(r)} disabled={busy || (r.is_default && r.active)}>
                  {r.active ? "Deactivate" : "Activate"}
                </Button>
              </span>
            ),
          },
        ]}
      />

      <section className="mt-6 max-w-md rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">{editId ? "Edit series" : "Add a series"}</h2>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-text-tertiary">Code {editId && <span className="text-text-tertiary">(fixed)</span>}</span>
            <Input value={code} disabled={!!editId || busy} onChange={(e) => setCode(e.target.value)} placeholder="RETAIL / WS / branch" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-text-tertiary">Prefix (on the invoice number)</span>
            <Input value={prefix} disabled={busy} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. RTL" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-text-tertiary">Number width (zero-padding)</span>
            <Input type="number" min={1} max={9} value={width} disabled={busy} onChange={(e) => setWidth(Number(e.target.value))} className="w-24" />
          </label>
          <div className="text-xs text-text-tertiary">
            Preview: <span className="tabular-nums">{seriesPreview(prefix, fy, width, editId ? rows.find((r) => r.id === editId)?.next_number ?? 1 : 1)}</span>
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {editId ? "Save changes" : "Add series"}
            </Button>
            {editId && (
              <Button variant="outline" onClick={resetForm} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </section>

      <p className="mt-4 max-w-md text-xs text-text-tertiary">
        The counter is allocated gap-free per financial year by the server (`next_doc_no`); new bills use the shop's
        <strong> default active</strong> series. Choosing a series per bill at the counter is tracked as SALT-209 (billing).
      </p>
    </Page>
  );
}
