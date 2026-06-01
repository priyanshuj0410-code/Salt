-- 0039: Salesman management (SALT-128).
--   * commission_pct on salesmen — the commission rate (percent of net sales)
--     the salesman performance + commission report multiplies the period net
--     sales by. Net sales = sum of taxable value (ex-GST) of placed invoices.
--   * salesman_id on payments — who collected the receipt, so "collections by
--     salesman" can be reported. Orders already carry sales_invoices.salesman_id
--     (added in 0024); collections needed their own attribution column.
--
-- Additive on top of the applied model (salesmen from 0024_settings,
-- payments from 0021_payments). Run once in the Supabase SQL editor.
-- Idempotent — safe to re-run.
-- Module: salesman · design: wiki/architecture/salesman.md

-- 1. commission rate on the salesman master ------------------------------
alter table public.salesmen
  add column if not exists commission_pct numeric not null default 0;

-- 2. who collected the receipt (for collections-by-salesman) -------------
alter table public.payments
  add column if not exists salesman_id uuid references public.salesmen (id) on delete set null;
create index if not exists payments_salesman_idx on public.payments (salesman_id);
