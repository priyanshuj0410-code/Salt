import { supabase } from "@/lib/supabase";
import { fetchAllPaged } from "@/lib/reportData";

/**
 * Salesman management (SALT-128) — data layer for the field-salesman master and
 * the per-salesman performance view (orders, commission, collections).
 *
 * Schema: `salesmen` (0024 + `commission_pct` in 0039), `sales_invoices.salesman_id`
 * (the order's salesman, 0024), `payments.salesman_id` (who collected, 0039).
 * Everything is per-org via RLS (`is_member`), so callers pass `orgId` only to
 * scope the read, never to bypass the policy.
 *
 * Commission basis: a salesman's commission for a period is `commission_pct` of
 * **net sales** — the GST-exclusive taxable value of their placed (non-cancelled)
 * invoices. MRP in pharma is tax-inclusive, so the taxable value (not the gross
 * total) is the honest commission base.
 */

/** A row of the `salesmen` master. */
export interface Salesman {
  id: string;
  name: string;
  phone: string | null;
  territory: string | null;
  commission_pct: number;
  is_active: boolean;
  created_at: string;
}

export const SALESMAN_SELECT = "id,name,phone,territory,commission_pct,is_active,created_at";

/** Editable form shape (numbers held as strings while typing). */
export interface SalesmanDraft {
  id?: string;
  name: string;
  phone: string;
  territory: string;
  commission_pct: string;
  is_active: boolean;
}

export const BLANK_SALESMAN: SalesmanDraft = {
  name: "",
  phone: "",
  territory: "",
  commission_pct: "",
  is_active: true,
};

export const toDraft = (s: Salesman): SalesmanDraft => ({
  id: s.id,
  name: s.name,
  phone: s.phone ?? "",
  territory: s.territory ?? "",
  commission_pct: s.commission_pct ? String(s.commission_pct) : "",
  is_active: s.is_active,
});

/** Per-salesman rollup over a date window. All money is integer paise. */
export interface SalesmanPerf {
  orders: number;
  netSalesPaise: number;
  grossSalesPaise: number;
  commissionPaise: number;
  collectionsPaise: number;
}

const ZERO_PERF: SalesmanPerf = {
  orders: 0,
  netSalesPaise: 0,
  grossSalesPaise: 0,
  commissionPaise: 0,
  collectionsPaise: 0,
};

interface InvAggRow {
  salesman_id: string | null;
  status: string;
  taxable_paise: number | null;
  total_paise: number | null;
}

interface PayAggRow {
  salesman_id: string | null;
  amount_paise: number | null;
}

const commissionOf = (netSalesPaise: number, pct: number) => Math.round((pct / 100) * netSalesPaise);

// -- master CRUD --------------------------------------------------------------

export async function listSalesmen(orgId: string): Promise<Salesman[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("salesmen")
    .select(SALESMAN_SELECT)
    .eq("org_id", orgId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Salesman[] | null) ?? [];
}

export async function getSalesman(orgId: string, id: string): Promise<Salesman | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("salesmen")
    .select(SALESMAN_SELECT)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Salesman | null) ?? null;
}

/** Validate + normalise a draft into a DB payload, or return an error string. */
export function validateDraft(draft: SalesmanDraft): { payload: Record<string, unknown> } | { error: string } {
  if (!draft.name.trim()) return { error: "Name is required." };
  const pct = draft.commission_pct.trim() === "" ? 0 : Number(draft.commission_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { error: "Commission must be a number between 0 and 100." };
  }
  return {
    payload: {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      territory: draft.territory.trim() || null,
      commission_pct: pct,
      is_active: draft.is_active,
    },
  };
}

export async function saveSalesman(orgId: string, draft: SalesmanDraft): Promise<void> {
  if (!supabase) throw new Error("Not connected.");
  const v = validateDraft(draft);
  if ("error" in v) throw new Error(v.error);
  const { error } = draft.id
    ? await supabase.from("salesmen").update(v.payload).eq("id", draft.id)
    : await supabase.from("salesmen").insert({ ...v.payload, org_id: orgId });
  if (error) throw new Error(error.message);
}

export async function deleteSalesman(id: string): Promise<void> {
  if (!supabase) throw new Error("Not connected.");
  const { error } = await supabase.from("salesmen").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// -- performance rollup -------------------------------------------------------

/**
 * Build a per-salesman performance map over [from, to] for the given salesmen.
 * Two paged reads (invoices, payments) grouped in JS — cheaper than N queries.
 * Every salesman in `salesmen` gets an entry (zeroed) so inactive / idle people
 * still render. Collections degrade to zero if `payments.salesman_id` is absent
 * (0039 not yet applied) rather than failing the whole view.
 */
export async function fetchPerf(
  orgId: string,
  from: string,
  to: string,
  salesmen: Salesman[],
): Promise<Map<string, SalesmanPerf>> {
  const perf = new Map<string, SalesmanPerf>();
  for (const s of salesmen) perf.set(s.id, { ...ZERO_PERF });
  if (!supabase) return perf;

  const invoices = await fetchAllPaged<InvAggRow>((lo, hi) =>
    supabase!
      .from("sales_invoices")
      .select("salesman_id,status,taxable_paise,total_paise")
      .eq("org_id", orgId)
      .not("salesman_id", "is", null)
      .neq("status", "cancelled")
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .range(lo, hi),
  );
  for (const r of invoices) {
    if (!r.salesman_id) continue;
    const p = perf.get(r.salesman_id);
    if (!p) continue; // salesman outside the passed list
    p.orders += 1;
    p.netSalesPaise += r.taxable_paise ?? 0;
    p.grossSalesPaise += r.total_paise ?? 0;
  }

  try {
    const payments = await fetchAllPaged<PayAggRow>((lo, hi) =>
      supabase!
        .from("payments")
        .select("salesman_id,amount_paise")
        .eq("org_id", orgId)
        .eq("direction", "received")
        .not("salesman_id", "is", null)
        .gte("payment_date", from)
        .lte("payment_date", to)
        .range(lo, hi),
    );
    for (const r of payments) {
      if (!r.salesman_id) continue;
      const p = perf.get(r.salesman_id);
      if (p) p.collectionsPaise += r.amount_paise ?? 0;
    }
  } catch {
    // payments.salesman_id missing (0039 unapplied) — leave collections at 0.
  }

  for (const s of salesmen) {
    const p = perf.get(s.id);
    if (p) p.commissionPaise = commissionOf(p.netSalesPaise, s.commission_pct);
  }
  return perf;
}

// -- per-salesman detail lists ------------------------------------------------

export interface SalesmanInvoice {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  status: string;
  taxable_paise: number;
  total_paise: number;
  paid_paise: number;
  ledgers: { name: string | null } | null;
}

const SM_INVOICE_SELECT =
  "id,invoice_no,invoice_date,status,taxable_paise,total_paise,paid_paise,ledgers(name)";

export async function listSalesmanInvoices(
  orgId: string,
  salesmanId: string,
  from: string,
  to: string,
): Promise<SalesmanInvoice[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("sales_invoices")
    .select(SM_INVOICE_SELECT)
    .eq("org_id", orgId)
    .eq("salesman_id", salesmanId)
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  // party (party_id -> ledgers) is a many-to-one embed: an object at runtime,
  // though the select-string type parser widens it to an array. Cast through unknown.
  return (data as unknown as SalesmanInvoice[] | null) ?? [];
}

export interface SalesmanCollection {
  id: string;
  payment_date: string;
  mode: string;
  amount_paise: number;
  reference: string | null;
  ledgers: { name: string | null } | null;
}

const SM_PAYMENT_SELECT = "id,payment_date,mode,amount_paise,reference,ledgers(name)";

export async function listSalesmanCollections(
  orgId: string,
  salesmanId: string,
  from: string,
  to: string,
): Promise<SalesmanCollection[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("payments")
      .select(SM_PAYMENT_SELECT)
      .eq("org_id", orgId)
      .eq("salesman_id", salesmanId)
      .eq("direction", "received")
      .gte("payment_date", from)
      .lte("payment_date", to)
      .order("payment_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as SalesmanCollection[] | null) ?? [];
  } catch {
    return []; // payments.salesman_id missing (0039 unapplied)
  }
}

// -- attribution (assign existing records to a salesman) ----------------------

/** A recent invoice with no salesman yet — candidate for attribution. */
export interface UnassignedInvoice {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  total_paise: number;
  ledgers: { name: string | null } | null;
}

export async function listUnassignedInvoices(orgId: string, sinceDays = 120): Promise<UnassignedInvoice[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("sales_invoices")
    .select("id,invoice_no,invoice_date,total_paise,ledgers(name)")
    .eq("org_id", orgId)
    .is("salesman_id", null)
    .neq("status", "cancelled")
    .gte("invoice_date", since)
    .order("invoice_date", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as unknown as UnassignedInvoice[] | null) ?? [];
}

export async function assignInvoices(ids: string[], salesmanId: string): Promise<void> {
  if (!supabase || ids.length === 0) return;
  const { error } = await supabase.from("sales_invoices").update({ salesman_id: salesmanId }).in("id", ids);
  if (error) throw new Error(error.message);
}

/** A recent received payment with no salesman yet — candidate for attribution. */
export interface UnassignedPayment {
  id: string;
  payment_date: string;
  mode: string;
  amount_paise: number;
  ledgers: { name: string | null } | null;
}

export async function listUnassignedPayments(orgId: string, sinceDays = 120): Promise<UnassignedPayment[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from("payments")
      .select("id,payment_date,mode,amount_paise,ledgers(name)")
      .eq("org_id", orgId)
      .eq("direction", "received")
      .is("salesman_id", null)
      .gte("payment_date", since)
      .order("payment_date", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data as unknown as UnassignedPayment[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function assignPayments(ids: string[], salesmanId: string): Promise<void> {
  if (!supabase || ids.length === 0) return;
  const { error } = await supabase.from("payments").update({ salesman_id: salesmanId }).in("id", ids);
  if (error) throw new Error(error.message);
}
