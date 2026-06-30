import { useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";
import { type ItemSold, type AgingViewRow } from "@/lib/reports";
import { scopeLabelFor } from "@/components/reports/useOrgShops";
import { ShopSelect } from "@/components/reports/report-controls";
import { useDashboardData } from "@/components/reports/useDashboardData";

export function DashboardPage() {
  const { shop } = useAuth();
  const navigate = useNavigate();
  const { data, loading, shops, shopFilter, setShopFilter, today } = useDashboardData();

  const scopeLabel = scopeLabelFor(shops, shopFilter, shop?.name);

  const lic = data.licenses;
  const licenseValue =
    lic.expired > 0
      ? `${lic.expired} expired`
      : lic.expiring > 0
        ? `${lic.expiring} expiring`
        : lic.total > 0
          ? "All current"
          : "None on file";
  const licenseTone = lic.expired > 0 || lic.expiring > 0 ? "danger" : lic.total > 0 ? "success" : "default";
  const licenseHint = lic.soonest?.expiry_date
    ? `Next: ${lic.soonest.license_type} expires ${lic.soonest.expiry_date}`
    : lic.total > 0
      ? `${lic.total} on file`
      : "Add in Settings → Drug licenses";

  return (
    <Page width="lg">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        subtitle={
          <span>
            {scopeLabel} · {today}
          </span>
        }
        actions={<ShopSelect shops={shops} value={shopFilter} onChange={setShopFilter} />}
      />

      {
        <div className="flex flex-col gap-7">
          {/* Today + money */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Today's sales"
              value={formatPaiseCompact(data.todayTotalPaise)}
              valueTitle={formatPaise(data.todayTotalPaise)}
              hint={`${data.todayCount} ${data.todayCount === 1 ? "invoice" : "invoices"}`}
            />
            <StatCard
              label="Cash / credit (today)"
              value={formatPaiseCompact(data.cashPaise)}
              valueTitle={formatPaise(data.cashPaise)}
              hint={`${formatPaise(data.creditPaise)} on credit`}
            />
            <StatCard
              label="Collected today"
              value={formatPaiseCompact(data.collectedPaise)}
              valueTitle={formatPaise(data.collectedPaise)}
              tone={data.collectedPaise > 0 ? "success" : "default"}
              hint={`${data.collectedCount} ${data.collectedCount === 1 ? "receipt" : "receipts"}`}
            />
            <StatCard
              label="Near expiry (≤30d)"
              value={`${data.nearExpiryCount} ${data.nearExpiryCount === 1 ? "batch" : "batches"}`}
              tone={data.nearExpiryCount > 0 ? "danger" : "success"}
              hint={
                data.expiredCount > 0
                  ? `${formatPaise(data.nearExpiryValuePaise)} at risk · ${data.expiredCount} expired`
                  : `${formatPaise(data.nearExpiryValuePaise)} at risk`
              }
            />
          </div>

          {/* Outstanding + compliance */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Overdue > 30 days"
              value={formatPaiseCompact(data.receivable.over30Paise)}
              valueTitle={formatPaise(data.receivable.over30Paise)}
              tone={data.receivable.over30Paise > 0 ? "danger" : "success"}
              hint={`${data.receivable.over30Parties} ${data.receivable.over30Parties === 1 ? "party" : "parties"}`}
            />
            <StatCard
              label="Receivables"
              value={formatPaiseCompact(data.receivable.outstandingPaise)}
              valueTitle={formatPaise(data.receivable.outstandingPaise)}
              hint={`${data.receivable.parties} ${data.receivable.parties === 1 ? "party owes" : "parties owe"}`}
            />
            <StatCard
              label="Payables"
              value={formatPaiseCompact(data.payable.outstandingPaise)}
              valueTitle={formatPaise(data.payable.outstandingPaise)}
              hint={`${data.payable.parties} ${data.payable.parties === 1 ? "vendor" : "vendors"}`}
            />
            <StatCard label="Drug licenses" value={licenseValue} tone={licenseTone} hint={licenseHint} />
          </div>

          {/* Top items + overdue collections */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-text-secondary">Top items sold today</h2>
              <DataTable<ItemSold>
                cols="1.6fr 0.6fr 0.9fr"
                rows={data.topItems}
                rowKey={(r) => r.itemId ?? `name:${r.name}`}
                loading={loading}
                empty={<EmptyState title="No sales yet today" hint="Items sold today will rank here by quantity." />}
                columns={[
                  { key: "name", header: "Item", cell: (r) => r.name, sortable: true, sortValue: (r) => r.name },
                  { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty, sortable: true, sortValue: (r) => r.qty },
                  { key: "value", header: "Value", numeric: true, cell: (r) => formatPaise(r.valuePaise), sortable: true, sortValue: (r) => r.valuePaise },
                ]}
              />
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-text-secondary">Overdue collections (&gt; 30 days)</h2>
              <DataTable<AgingViewRow>
                cols="1.4fr 1fr 0.9fr"
                rows={data.overdueParties}
                rowKey={(r) => r.party_id}
                loading={loading}
                onRowActivate={(r) => navigate(`/parties/${r.party_id}`)}
                empty={<EmptyState title="Nothing overdue" hint="Customers more than 30 days late will surface here." />}
                columns={[
                  { key: "name", header: "Party", cell: (r) => r.name || "—" },
                  { key: "out", header: "Outstanding", numeric: true, cell: (r) => formatPaise(r.outstanding_paise) },
                  {
                    key: "d90",
                    header: "90+ days",
                    numeric: true,
                    cell: (r) => (
                      <span className={r.d90_plus_paise > 0 ? "text-danger" : undefined}>
                        {formatPaise(r.d90_plus_paise)}
                      </span>
                    ),
                  },
                ]}
              />
            </section>
          </div>

          <p className="text-xs text-text-tertiary">
            Live figures for operational (post-cutover) documents{shops.length > 1 ? " across the selected shop scope" : ""}.
            Receivables / payables age open invoices by due date and are org-wide (party-level); imported opening balances
            live in Parties. Sales count today in IST.
          </p>
        </div>
      }
    </Page>
  );
}
