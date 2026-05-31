-- 0026: Import extension for returns — provenance, idempotency, and cutover on
-- credit_notes (sales returns) and debit_notes (purchase returns), so historical
-- return registers import as non-posting records (Smart Import Phase 3, SALT-149).
--
-- Additive on top of 0025 (which covered purchases + sales_invoices). Run once in
-- the Supabase SQL editor. Idempotent — safe to re-run.
-- Design: wiki/architecture/smart-import-extension.md · ADRs 0011 (idempotency),
-- 0012 (stock snapshot-cutover), 0013 (GL opening-only).

-- credit_notes (sales returns)
alter table public.credit_notes add column if not exists source_system text;
alter table public.credit_notes add column if not exists source_doc_no text;
alter table public.credit_notes add column if not exists posts_effects boolean not null default true;
create unique index if not exists credit_notes_source_doc_idx
  on public.credit_notes (org_id, shop_id, source_system, source_doc_no)
  where source_doc_no is not null;

-- debit_notes (purchase returns)
alter table public.debit_notes add column if not exists source_system text;
alter table public.debit_notes add column if not exists source_doc_no text;
alter table public.debit_notes add column if not exists posts_effects boolean not null default true;
create unique index if not exists debit_notes_source_doc_idx
  on public.debit_notes (org_id, shop_id, source_system, source_doc_no)
  where source_doc_no is not null;

-- Note: payments gets the same three columns + index in its own phase (SALT-150).
