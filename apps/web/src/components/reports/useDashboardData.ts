import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
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
import { useOrgShops, ALL_SHOPS, type OrgShop } from "@/components/reports/useOrgShops";

/** A `sales_invoices` row for today's headline numbers. */
interface TodayInvoice {
  id: string;
  payment_method: string | null;
  total_paise: number;
}

/** Aggregated dashboard payload, all derived client-side from the fetched rows. */
export interface DashboardData {
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

/**
 * The org's operational pulse — one batched fetch (no RPC, no store), shared by
 * the Reports Dashboard AND the V2 assembled Home (WS3) so they never double-fetch.
 * Extracted verbatim from DashboardPage; preserves the stale-guard, the
 * [orgId, shopFilter, today] deps, the org-wide aging views, and the sale_lines
 * fan-out. Owns its own `today`/shops/shopFilter so callers just consume the result.
 */
export function useDashboardData(): {
  data: DashboardData;
  loading: boolean;
  shops: OrgShop[];
  shopFilter: string;
  setShopFilter: (s: string) => void;
  today: string;
} {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const today = useMemo(() => istToday(), []);
  const { shops } = useOrgShops();
  const [shopFilter, setShopFilter] = useState<string>(ALL_SHOPS);
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const db = supabase;
    const oneShop = shopFilter === ALL_SHOPS ? null : shopFilter;

    (async () => {
      setLoading(true);

      // Today's placed, operational sales — headline + cash/credit split.
      let todayQ = db
        .from("sales_invoices")
        .select("id,payment_method,total_paise")
        .eq("org_id", orgId)
        .eq("status", "placed")
        .eq("posts_effects", true)
        .eq("invoice_date", today);
      if (oneShop) todayQ = todayQ.eq("shop_id", oneShop);

      // Money collected today (cleared receipts from customers).
      let receiptsQ = db
        .from("payments")
        .select("amount_paise")
        .eq("org_id", orgId)
        .eq("direction", "received")
        .eq("status", "cleared")
        .eq("payment_date", today);
      if (oneShop) receiptsQ = receiptsQ.eq("shop_id", oneShop);

      // Receivables / payables aging — party-level across the org (the aging views
      // are not shop-scoped), so these stay org-wide regardless of the shop filter.
      const recvQ = db
        .from("v_receivables_aging")
        .select("party_id,party_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise")
        .eq("org_id", orgId);
      const payQ = db
        .from("v_payables_aging")
        .select("vendor_id,vendor_name,outstanding_paise,d0_30_paise,d31_60_paise,d61_90_paise,d90_plus_paise")
        .eq("org_id", orgId);

      // Near-expiry batches (expired + within 60 days).
      let expiryQ = db
        .from("v_near_expiry")
        .select("bucket,qty,stock_value_paise,days_to_expiry")
        .eq("org_id", orgId)
        .lte("days_to_expiry", 60);
      if (oneShop) expiryQ = expiryQ.eq("shop_id", oneShop);

      // Drug licenses on file.
      let licQ = db
        .from("drug_licenses")
        .select("license_type,license_no,holder_name,expiry_date")
        .eq("org_id", orgId);
      if (oneShop) licQ = licQ.eq("shop_id", oneShop);

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
  }, [orgId, shopFilter, today]);

  return { data, loading, shops, shopFilter, setShopFilter, today };
}
