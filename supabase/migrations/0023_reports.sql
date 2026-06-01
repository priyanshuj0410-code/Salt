-- 0023: Reports & analytics — derived views over the two backbones, plus a
-- general audit log. Views use security_invoker so per-org RLS still applies.
-- On-hand reads the batches cache; the audit trail and financials read the
-- stock_movements / ledger_entries ledgers. These are starting points to refine.
-- Depends on: stock_movements (0016), accounting (0017), documents (0018-0021). Run after 0022.

-- 1. Inventory views -----------------------------------------------------
create view public.v_stock_on_hand with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, b.id as batch_id,
    b.batch_no, b.expiry_date, b.qty, b.mrp_paise, b.ptr_paise,
    (b.qty * b.ptr_paise) as stock_value_paise
  from public.batches b join public.items i on i.id = b.item_id
  where b.qty <> 0;

create view public.v_near_expiry with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, b.batch_no, b.expiry_date, b.qty,
    (b.expiry_date - current_date) as days_to_expiry,
    case
      when b.expiry_date < current_date then 'expired'
      when b.expiry_date <= current_date + 30 then '0-30'
      when b.expiry_date <= current_date + 60 then '31-60'
      when b.expiry_date <= current_date + 90 then '61-90'
      else '90+'
    end as bucket,
    (b.qty * b.ptr_paise) as stock_value_paise
  from public.batches b join public.items i on i.id = b.item_id
  where b.qty > 0 and b.expiry_date is not null;

-- Items in stock with no sale movement in the last 90 days (or ever).
create view public.v_dead_stock with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, sum(b.qty) as qty,
    sum(b.qty * b.ptr_paise) as stock_value_paise, max(sm.last_sale) as last_sold_at
  from public.batches b
  join public.items i on i.id = b.item_id
  left join (
    select item_id, shop_id, max(created_at) as last_sale
    from public.stock_movements where reason = 'sale' group by item_id, shop_id
  ) sm on sm.item_id = b.item_id and sm.shop_id = b.shop_id
  where b.qty > 0
  group by b.org_id, b.shop_id, b.item_id, i.name
  having max(sm.last_sale) is null or max(sm.last_sale) < now() - interval '90 days';

-- 2. Document registers --------------------------------------------------
create view public.v_sales_register with (security_invoker = true) as
  select si.org_id, si.shop_id, si.id, si.invoice_no, si.invoice_date, si.party_id,
    coalesce(l.name, 'Walk-in') as party_name, si.is_interstate,
    si.taxable_paise, si.cgst_paise, si.sgst_paise, si.igst_paise, si.total_paise, si.paid_paise, si.status
  from public.sales_invoices si left join public.ledgers l on l.id = si.party_id;

create view public.v_purchase_register with (security_invoker = true) as
  select p.org_id, p.shop_id, p.id, p.grn_no, p.vendor_invoice_no, p.received_date,
    p.vendor_id, l.name as vendor_name, p.is_interstate,
    p.taxable_paise, p.cgst_paise, p.sgst_paise, p.igst_paise, p.total_paise, p.paid_paise, p.status
  from public.purchases p join public.ledgers l on l.id = p.vendor_id;

-- 3. Aging (from unpaid documents) --------------------------------------
create view public.v_receivables_aging with (security_invoker = true) as
  select si.org_id, si.party_id, l.name as party_name,
    sum(si.total_paise - si.paid_paise) as outstanding_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) <= 30 then si.total_paise - si.paid_paise else 0 end) as d0_30_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) between 31 and 60 then si.total_paise - si.paid_paise else 0 end) as d31_60_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) between 61 and 90 then si.total_paise - si.paid_paise else 0 end) as d61_90_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) > 90 then si.total_paise - si.paid_paise else 0 end) as d90_plus_paise
  from public.sales_invoices si join public.ledgers l on l.id = si.party_id
  where si.total_paise > si.paid_paise
  group by si.org_id, si.party_id, l.name;

create view public.v_payables_aging with (security_invoker = true) as
  select p.org_id, p.vendor_id, l.name as vendor_name,
    sum(p.total_paise - p.paid_paise) as outstanding_paise,
    sum(case when current_date - p.received_date <= 30 then p.total_paise - p.paid_paise else 0 end) as d0_30_paise,
    sum(case when current_date - p.received_date between 31 and 60 then p.total_paise - p.paid_paise else 0 end) as d31_60_paise,
    sum(case when current_date - p.received_date between 61 and 90 then p.total_paise - p.paid_paise else 0 end) as d61_90_paise,
    sum(case when current_date - p.received_date > 90 then p.total_paise - p.paid_paise else 0 end) as d90_plus_paise
  from public.purchases p join public.ledgers l on l.id = p.vendor_id
  where p.total_paise > p.paid_paise
  group by p.org_id, p.vendor_id, l.name;

-- 4. Financials (from the double-entry ledger) --------------------------
-- One row per account and per party. A balanced book sums balance_paise to 0.
create view public.v_trial_balance with (security_invoker = true) as
  select le.org_id, 'account'::text as kind, ca.code, ca.name, ca.type,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where le.account_id is not null
  group by le.org_id, ca.code, ca.name, ca.type
  union all
  select le.org_id, 'party'::text as kind, null as code, l.name,
    case when l.type = 'vendor' then 'liability' else 'asset' end as type,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.ledgers l on l.id = le.party_id
  where le.party_id is not null
  group by le.org_id, l.name, l.type;

create view public.v_pnl with (security_invoker = true) as
  select le.org_id, ca.type, ca.code, ca.name,
    sum(le.credit_paise) - sum(le.debit_paise) as amount_paise   -- income +, expense -
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where ca.type in ('income', 'expense')
  group by le.org_id, ca.type, ca.code, ca.name;

create view public.v_balance_sheet with (security_invoker = true) as
  select le.org_id, ca.type, ca.code, ca.name,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where ca.type in ('asset', 'liability', 'equity')
  group by le.org_id, ca.type, ca.code, ca.name;

-- 5. audit_log: general before/after trail (beyond stock_movements) -----
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  user_id uuid references auth.users (id),
  action text not null,                         -- insert | update | delete | custom
  table_name text,
  row_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
create policy "audit_log read"   on public.audit_log for select using (public.is_member(org_id));
create policy "audit_log insert" on public.audit_log for insert with check (public.is_member(org_id));
create policy "audit_log update" on public.audit_log for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "audit_log delete" on public.audit_log for delete using (public.is_member(org_id));
