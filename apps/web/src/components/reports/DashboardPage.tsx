import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import {
  istToday,
  topItemsSold,
  cashCreditSplit,
  summarizeLicenses,
  sumAging,
  type SoldLineRow,
  type ItemSold,
  type AgingViewRow,
  type LicenseRow,
} from "@/lib/reports";

/** A `sales_invoices` row for today's headline numbers. */
interface TodayInvoice {
  id: string;
  payment_method: string | null;
  total_paise: number;
}

/** Aggregated dashboard payload, all derived client-side from the fetched rows. */
interface DashboardData {
  todayTotalPaise: number;
  todayCount: number;
  cashPaise: number;
  creditPaise: number;
  collectedPaise: number;
  collectedCount: number;
  receivable: ReturnType<typeof sumAging>;
  payable: ReturnType<typeof sumAging>;
  overdueParties: AgingViewRow[];
  nearExpiryCount: number;
  nearExpiryValuePaise: number;
  expiredCount: number;
  topItems: ItemSold[];
  licenses: ReturnType<typeof summarizeLicenses>;
}

const EMPTY: DashboardData = {
  todayTotalPaise: 0,
  todayCount: 0,
  cashPaise: 0,
  creditPaise: 0,
  collectedPaise: 0,
  collectedCount: 0,
  receivable: sumAging([]),
  payable: sumAging([]),
  overdueParties: [],
  nearExpiryCount: 0,
  nearExpiryValuePaise: 0,
  expiredCount: 0,
  topItems: [],
  licenses: summarizeLicenses([], istToday()),
};

/** Near-expiry buckets that count as "act now" on the dashboard headline. */
const SOON_BUCKETS = ["0-30"];

export function DashboardPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();
  const today = useMemo(() => istToday(), []);
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const db = supabase;

    (async () => {
      setLoading(true);

      // Today's placed, operational sales — headline + cash/credit split.
      const todayQ = db
        .from("sales_invoices")
        .select("id,payment_method,total_paise")
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "placed")
        .eq("posts_effects", true)
        .eq("invoice_date", today);

      // Money collected today (cleared receipts from customers).
      const receiptsQ = db
        .from("payments")
        .select("amount_paise")
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("direction", "received")
        .eq("status", "cleared")
        .eq("payment_date", today);

      // Org-wide receivables / payables aging (open documents).
      const recvQ = db
        .from("v_receivables_aging")
        .select("party_id,party_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise")
        .eq("org_id", orgId);
      const payQ = db
        .from("v_payables_aging")
        .select("vendor_id,vendor_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise")
        .eq("org_id", orgId);

      // Near-expiry batches for this shop (expired + within 60 days).
      const expiryQ = db
        .from("v_near_expiry")
        .select("bucket,qty,stock_value_paise,days_to_expiry")
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .lte("days_to_expiry", 60);

      // Drug licenses on file for this shop.
      const licQ = db
        .from("drug_licenses")
        .select("license_type,license_no,holder_name,expiry_date")
        .eq("org_id", orgId)
        .eq("shop_id", shopId);

      const [todayRes, receiptsRes, recvRes, payRes, expiryRes, licRes] = await Promise.all([
        todayQ,
        receiptsQ,
        recvQ,
        payQ,
        expiryQ,
        licQ,
      ]);
      if (!active) return;

      const todayInvoices = (todayRes.data as TodayInvoice[] | null) ?? [];
      const split = cashCreditSplit(todayInvoices);
      const receipts = (receiptsRes.data as { amount_paise: number }[] | null) ?? [];

      // Top items need the lines for today's invoices (chunked by invoice id).
      const ids = todayInvoices.map((i) => i.id);
      const soldLines: SoldLineRow[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const { data: ld } = await db
          .from("sale_lines")
          .select("item_id,name,qty,line_total_paise")
          .in("invoice_id", ids.slice(i, i + 300));
        if (ld) soldLines.push(...(ld as SoldLineRow[]));
      }
      if (!active) return;

      // Map aging views (party/vendor name columns differ) onto the shared shape.
      const recvRows: AgingViewRow[] = (
        (recvRes.data as (Omit<AgingViewRow, "name"> & { party_name: string })[] | null) ?? []
      ).map((r) => ({ ...r, name: r.party_name }));
      const payRowsRaw = (payRes.data as
        | (Omit<AgingViewRow, "name" | "party_id"> & { vendor_id: string; vendor_name: string })[]
        | null) ?? [];
      const payRows: AgingViewRow[] = payRowsRaw.map((r) => ({ ...r, party_id: r.vendor_id, name: r.vendor_name }));

      const expiryRows = (expiryRes.data as { bucket: string; qty: number; stock_value_paise: number }[] | null) ?? [];
      let nearExpiryCount = 0;
      let nearExpiryValuePaise = 0;
      let expiredCount = 0;
      for (const r of expiryRows) {
        if (r.bucket === "expired") expiredCount += 1;
        if (SOON_BUCKETS.includes(r.bucket)) {
          nearExpiryCount += 1;
          nearExpiryValuePaise += r.stock_value_paise;
        }
      }

      const overdueParties = recvRows
        .filter((r) => r.d31_60_paise + r.d61_90_paise + r.d90_plus_paise > 0)
        .sort((a, b) => b.outstanding_paise - a.outstanding_paise)
        .slice(0, 8);

      setData({
        todayTotalPaise: todayInvoices.reduce((s, i) => s + i.total_paise, 0),
        todayCount: todayInvoices.length,
        cashPaise: split.cashPaise,
        creditPaise: split.creditPaise,
        collectedPaise: receipts.reduce((s, r) => s + r.amount_paise, 0),
        collectedCount: receipts.length,
        receivable: sumAging(recvRows),
        payable: sumAging(payRows),
        overdueParties,
        nearExpiryCount,
        nearExpiryValuePaise,
        expiredCount,
        topItems: topItemsSold(soldLines, 10),
        licenses: summarizeLicenses((licRes.data as LicenseRow[] | null) ?? [], today),
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopId, today]);

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
            {shop?.name ?? "This shop"} · {today}
          </span>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="The dashboard summarises one shop. Pick a shop to continue." />
      ) : (
        <div className="flex flex-col gap-7">
          {/* Today + money */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Today's sales"
              value={formatPaise(data.todayTotalPaise)}
              hint={`${data.todayCount} ${data.todayCount === 1 ? "invoice" : "invoices"}`}
            />
            <StatCard
              label="Cash / credit (today)"
              value={formatPaise(data.cashPaise)}
              hint={`${formatPaise(data.creditPaise)} on credit`}
            />
            <StatCard
              label="Collected today"
              value={formatPaise(data.collectedPaise)}
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
              value={formatPaise(data.receivable.over30Paise)}
              tone={data.receivable.over30Paise > 0 ? "danger" : "success"}
              hint={`${data.receivable.over30Parties} ${data.receivable.over30Parties === 1 ? "party" : "parties"}`}
            />
            <StatCard
              label="Receivables"
              value={formatPaise(data.receivable.outstandingPaise)}
              hint={`${data.receivable.parties} ${data.receivable.parties === 1 ? "party owes" : "parties owe"}`}
            />
            <StatCard
              label="Payables"
              value={formatPaise(data.payable.outstandingPaise)}
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
                  { key: "name", header: "Item", cell: (r) => r.name },
                  { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                  { key: "value", header: "Value", numeric: true, cell: (r) => formatPaise(r.valuePaise) },
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
            Live figures for operational (post-cutover) documents. Receivables / payables age open invoices by due date;
            imported opening balances live in Parties. Sales count today in IST.
          </p>
        </div>
      )}
    </Page>
  );
}
