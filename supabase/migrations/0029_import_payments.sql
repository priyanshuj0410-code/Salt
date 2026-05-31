-- 0029: Import extension for payments — provenance, idempotency, and cutover on
-- the payments table, so historical receipt/payment (cash & bank book) registers
-- import as non-posting records (Smart Import Phase 4, SALT-150).
--
-- Additive on top of 0025 (purchases + sales_invoices) and 0026 (credit/debit
-- notes). Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Design: wiki/architecture/smart-import-extension.md · ADRs 0011 (idempotency),
-- 0012 (stock snapshot-cutover), 0013 (GL opening-only).
--
-- posts_effects=false marks an imported historical payment: it is a record only,
-- so consumers that net payments into a party's due (PartyProfilePage's
-- paymentsAdjustment) must skip it — the opening balance already reflects every
-- pre-cutover receipt/payment, so counting it again would double-reduce the due.

alter table public.payments add column if not exists source_system text;
alter table public.payments add column if not exists source_doc_no text;
alter table public.payments add column if not exists posts_effects boolean not null default true;
create unique index if not exists payments_source_doc_idx
  on public.payments (org_id, shop_id, source_system, source_doc_no)
  where source_doc_no is not null;
