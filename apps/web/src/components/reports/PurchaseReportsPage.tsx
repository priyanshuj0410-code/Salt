import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ViewTabs, RangeControls, ExportButton, type ReportView } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { fetchAllPaged } from "@/lib/reportData";
import {
  presetRange,
  rollupLines,
  rollupParties,
  sumBy,
  downloadCsv,
  paiseToRupeeStr,
  type LineGroup,
  type PartyGroup,
} from "@/lib/reports";

interface PurchaseRow {
  id: string;
  grn_no: string | null;
  vendor_invoice_no: string | null;
  received_date: string;
  status: string;
  vendor_id: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  paid_paise: number;
  ledgers: { name: string | null; gstin: string | null } | null;
}

interface PurchaseLineRow {
  purchase_id: string;
  item_id: string | null;
  name: string;
  qty: number;
  free_qty: number;
  ptr_paise: number;
  scheme_text: string | null;
  taxable_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const GRN_COLS =
  "id,grn_no,vendor_invoice_no,received_date,status,vendor_id,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,ledgers(name,gstin)";
const LINE_COLS =
  "purchase_id,item_id,name,qty,free_qty,ptr_paise,scheme_text,taxable_paise,gst_rate,line_total_paise,purchases!inner(received_date)";

type ViewKey = "register" | "vendors" | "items" | "schemes";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "register", label: "GRN register" },
  { key: "vendors", label: "Vendor-wise" },
  { key: "items", label: "Item-wise" },
  { key: "schemes", label: "Scheme tracking" },
];

const gstOf = (p: PurchaseRow) => p.cgst_paise + p.sgst_paise + p.igst_paise;

export function PurchaseReportsPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();
  const [range, setRange] = useState(() => presetRange("month"));
  const [view, setView] = useState<ViewKey>("register");
  const [grns, setGrns] = useState<PurchaseRow[]>([]);
  const [lines, setLines] = useState<PurchaseLineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const db = supabase;
    const { from, to } = range;

    (async () => {
      setLoading(true);
      const [gs, ls] = await Promise.all([
        fetchAllPaged<PurchaseRow>((f, t) =>
          db
            .from("purchases")
            .select(GRN_COLS)
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .eq("posts_effects", true)
            .eq("status", "received")
            .gte("received_date", from)
            .lte("received_date", to)
            .order("received_date", { ascending: false })
            .range(f, t),
        ),
        fetchAllPaged<PurchaseLineRow>((f, t) =>
          db
            .from("purchase_lines")
            .select(LINE_COLS)
            .eq("org_id", orgId)
            .eq("purchases.shop_id", shopId)
            .eq("purchases.status", "received")
            .eq("purchases.posts_effects", true)
            .gte("purchases.received_date", from)
            .lte("purchases.received_date", to)
            .range(f, t),
        ),
      ]);
      if (!active) return;
      setGrns(gs);
      setLines(ls);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopId, range]);

  const grnDocs = useMemo(() => grns.map((g) => ({ ...g, date: g.received_date })), [grns]);
  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grns) m.set(g.id, g.ledgers?.name ?? "—");
    return m;
  }, [grns]);

  const totals = useMemo(
    () => ({
      count: grns.length,
      taxable: sumBy(grns, (g) => g.taxable_paise),
      gst: sumBy(grns, gstOf),
      total: sumBy(grns, (g) => g.total_paise),
    }),
    [grns],
  );

  const vendors = useMemo(
    () => rollupParties(grnDocs, (g) => g.vendor_id, (g) => g.ledgers?.name ?? "—"),
    [grnDocs],
  );
  const items = useMemo(
    () => rollupLines(lines, (l) => l.item_id ?? `name:${l.name}`, (l) => l.name || "—"),
    [lines],
  );
  const schemeLines = useMemo(
    () => lines.filter((l) => l.free_qty > 0 || (l.scheme_text && l.scheme_text.trim() !== "")),
    [lines],
  );

  const periodTag = `${range.from}_${range.to}`;
  const exporters: Record<ViewKey, () => void> = {
    register: () =>
      downloadCsv(
        `purchase-register-${periodTag}.csv`,
        ["Date", "GRN", "Vendor invoice", "Vendor", "Taxable", "GST", "Total"],
        grns.map((g) => [
          g.received_date,
          g.grn_no ?? g.id.slice(0, 8),
          g.vendor_invoice_no ?? "",
          g.ledgers?.name ?? "—",
          paiseToRupeeStr(g.taxable_paise),
          paiseToRupeeStr(gstOf(g)),
          paiseToRupeeStr(g.total_paise),
        ]),
      ),
    vendors: () =>
      downloadCsv(
        `purchase-vendors-${periodTag}.csv`,
        ["Vendor", "GRNs", "Total", "Outstanding", "Last GRN"],
        vendors.map((v) => [v.name, v.docs, paiseToRupeeStr(v.totalPaise), paiseToRupeeStr(v.outstandingPaise), v.lastDate]),
      ),
    items: () =>
      downloadCsv(
        `purchase-items-${periodTag}.csv`,
        ["Item", "Qty", "Lines", "Taxable", "Total"],
        items.map((r) => [r.label, r.qty, r.lines, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.totalPaise)]),
      ),
    schemes: () =>
      downloadCsv(
        `purchase-schemes-${periodTag}.csv`,
        ["Item", "Vendor", "Qty", "Free", "Scheme", "Taxable"],
        schemeLines.map((l) => [
          l.name,
          vendorName.get(l.purchase_id) ?? "—",
          l.qty,
          l.free_qty,
          l.scheme_text ?? "",
          paiseToRupeeStr(l.taxable_paise),
        ]),
      ),
  };

  const hasAny = grns.length > 0;

  return (
    <Page width="lg">
      <PageHeader
        icon={ShoppingCart}
        title="Purchase reports"
        subtitle={shop?.name ?? "This shop"}
        actions={
          <>
            <RangeControls from={range.from} to={range.to} onChange={setRange} />
            <ExportButton onExport={exporters[view]} disabled={!hasAny} />
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Purchase reports summarise one shop. Pick a shop to continue." />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="GRNs" value={totals.count} hint={`${range.from} → ${range.to}`} />
            <StatCard label="Taxable value" value={formatPaise(totals.taxable)} />
            <StatCard label="ITC (GST)" value={formatPaise(totals.gst)} />
            <StatCard label="Total purchases" value={formatPaise(totals.total)} />
          </div>

          <ViewTabs views={VIEWS} value={view} onChange={setView} />

          {view === "register" && (
            <DataTable<PurchaseRow>
              cols="0.8fr 1fr 1fr 1.4fr 1fr 0.9fr 1fr"
              rows={grns}
              rowKey={(r) => r.id}
              loading={loading}
              onRowActivate={(r) => navigate(`/purchases/${r.id}`)}
              empty={<EmptyState title="No purchases in range" hint="Receive stock (GRN) to populate this register." />}
              columns={[
                { key: "date", header: "Date", cell: (r) => r.received_date },
                { key: "grn", header: "GRN", cell: (r) => <span className="tabular-nums">{r.grn_no ?? `#${r.id.slice(0, 8)}`}</span> },
                { key: "vinv", header: "Vendor inv.", cell: (r) => r.vendor_invoice_no || "—" },
                { key: "vendor", header: "Vendor", cell: (r) => r.ledgers?.name ?? "—" },
                { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxable_paise) },
                { key: "gst", header: "ITC", numeric: true, cell: (r) => formatPaise(gstOf(r)) },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.total_paise) },
              ]}
            />
          )}

          {view === "vendors" && (
            <DataTable<PartyGroup>
              cols="1.6fr 0.6fr 1fr 1fr 0.9fr"
              rows={vendors}
              rowKey={(r) => r.key}
              loading={loading}
              onRowActivate={(r) => navigate(`/parties/${r.key}`)}
              empty={<EmptyState title="No vendors in range" />}
              columns={[
                { key: "name", header: "Vendor", cell: (r) => r.name },
                { key: "grns", header: "GRNs", numeric: true, cell: (r) => r.docs },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
                {
                  key: "out",
                  header: "Payable",
                  numeric: true,
                  cell: (r) => (
                    <span className={r.outstandingPaise > 0 ? "text-text-primary" : "text-success"}>{formatPaise(r.outstandingPaise)}</span>
                  ),
                },
                { key: "last", header: "Last GRN", cell: (r) => r.lastDate },
              ]}
            />
          )}

          {view === "items" && (
            <DataTable<LineGroup>
              cols="1.8fr 0.6fr 0.6fr 1fr 1fr"
              rows={items}
              rowKey={(r) => r.key}
              loading={loading}
              empty={<EmptyState title="No items purchased in range" />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.label },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "lines", header: "Lines", numeric: true, cell: (r) => r.lines },
                { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
              ]}
            />
          )}

          {view === "schemes" && (
            <div className="flex flex-col gap-2">
              <DataTable<PurchaseLineRow>
                cols="1.5fr 1.2fr 0.6fr 0.6fr 1fr 1fr"
                rows={schemeLines}
                rowKey={(r) => `${r.purchase_id}:${r.item_id ?? r.name}:${r.scheme_text ?? ""}`}
                loading={loading}
                empty={<EmptyState title="No scheme goods in range" hint="Free goods (e.g. 10+1) and scheme notes captured at GRN appear here." />}
                columns={[
                  { key: "item", header: "Item", cell: (r) => r.name },
                  { key: "vendor", header: "Vendor", cell: (r) => vendorName.get(r.purchase_id) ?? "—" },
                  { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                  { key: "free", header: "Free", numeric: true, cell: (r) => <span className={r.free_qty > 0 ? "text-success" : undefined}>{r.free_qty}</span> },
                  { key: "scheme", header: "Scheme", cell: (r) => r.scheme_text || "—" },
                  { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxable_paise) },
                ]}
              />
              <p className="text-xs text-text-tertiary">
                Free goods carry zero ITC but real MRP value. Lines show where a scheme (free qty or a note) was captured at receipt.
              </p>
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            Operational (post-cutover) GRNs with effects posted. Purchases are tax-exclusive (GST/ITC on top of PTR);
            &ldquo;ITC&rdquo; is the input tax on the period&rsquo;s receipts.
          </p>
        </div>
      )}
    </Page>
  );
}
