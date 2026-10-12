import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Tag, Plus, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { schemeIsActive, type VendorScheme } from "@/lib/grn";
import { SchemeDialog, type SchemeRow } from "./SchemeDialog";

interface Row extends SchemeRow {
  vendor: { name: string } | null;
  item: { name: string } | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Describe a scheme's deal in one line: discount and/or free-goods ratio. */
function dealText(s: SchemeRow): string {
  const parts: string[] = [];
  if (s.discount_type && s.discount_value)
    parts.push(s.discount_type === "flat" ? `${formatPaise(s.discount_value)} off` : `${s.discount_value}% off`);
  if (s.scheme_buy_qty > 0 && s.scheme_free_qty > 0) parts.push(`${s.scheme_buy_qty}+${s.scheme_free_qty} free`);
  return parts.join(" · ") || "-";
}

const toScheme = (r: SchemeRow): VendorScheme => ({
  id: r.id,
  vendorId: r.vendor_id,
  itemId: r.item_id,
  label: r.label,
  discountType: r.discount_type,
  discountValue: r.discount_value,
  schemeBuyQty: r.scheme_buy_qty,
  schemeFreeQty: r.scheme_free_qty,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  active: r.active,
});

export function VendorSchemesPage() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchemeRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("vendor_schemes")
      .select(
        "id,vendor_id,item_id,label,discount_type,discount_value,scheme_buy_qty,scheme_free_qty,valid_from,valid_to,active,vendor:ledgers(name),item:items(name)",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as Row[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const activeCount = useMemo(() => rows.filter((r) => schemeIsActive(toScheme(r), today())).length, [rows]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(r: Row) {
    setEditing(r);
    setDialogOpen(true);
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={Tag}
        title="Vendor schemes"
        subtitle="Standing distributor deals: trade discount and/or free goods. Auto-applied and flagged when you receive stock."
        actions={
          <Button onClick={openNew}>
            <Plus /> New scheme
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Schemes" value={rows.length} />
        <StatCard label="Active today" value={activeCount} />
        <StatCard label="Vendors" value={new Set(rows.map((r) => r.vendor_id)).size} />
      </div>

      <DataTable<Row>
        rows={rows}
        rowKey={(r) => r.id}
        cols="1.2fr 1.2fr 1fr 0.9fr 0.6fr"
        onRowActivate={openEdit}
        loading={loading}
        empty={
          <EmptyState
            icon={Tag}
            title="No vendor schemes yet"
            hint="Record a distributor's standing deal so it auto-applies at GRN."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus /> New scheme
              </Button>
            }
          />
        }
        columns={[
          { key: "vendor", header: "Vendor", cell: (r) => r.vendor?.name ?? "Vendor" },
          {
            key: "scope",
            header: "Applies to",
            cell: (r) => (r.item ? r.item.name : <span className="text-text-tertiary">All items</span>),
          },
          { key: "deal", header: "Deal", cell: (r) => dealText(r) },
          {
            key: "valid",
            header: "Validity",
            cell: (r) => (
              <span className="text-text-tertiary">
                {r.valid_from ? format(new Date(r.valid_from), "d MMM") : "-"}
                {": "}
                {r.valid_to ? format(new Date(r.valid_to), "d MMM yyyy") : "open"}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (r) => {
              const live = schemeIsActive(toScheme(r), today());
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={live ? "success" : "neutral"}>{live ? "active" : r.active ? "scheduled" : "off"}</Badge>
                  <Pencil className="size-3 text-text-tertiary" />
                </span>
              );
            },
          },
        ]}
      />

      {dialogOpen && (
        <SchemeDialog
          open
          onOpenChange={setDialogOpen}
          orgId={orgId}
          editing={editing}
          onSaved={() => {
            setDialogOpen(false);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </Page>
  );
}
