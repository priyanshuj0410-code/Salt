-- 0025: Import extension — provenance, idempotency, and cutover for importing
-- historical Marg documents (Smart Import beyond the four-file cascade).
--
-- Additive on top of the applied target model (supabase/proposed/0014-0024,
-- applied via full_data_model.sql). Run once in the Supabase SQL editor.
-- Design: wiki/architecture/smart-import-extension.md · ADRs 0011 (idempotency),
-- 0012 (stock snapshot-cutover). Idempotent — safe to re-run.

-- Cutover date per shop (ADR 0012): the opening snapshot (trial balance + stock)
-- is authoritative up to this date; documents dated on/before it import as records
-- only (posts_effects = false) and must NOT move stock or post double entries.
alter table public.shops add column if not exists cutover_date date;

-- Document provenance + idempotency (ADR 0011).
--   source_system  — origin, e.g. 'marg'
--   source_doc_no  — the original Marg bill/voucher number (provenance + dedup key)
--   posts_effects  — true for live/operational docs; the importer sets false for
--                    historical rows so reports/RPCs can skip their side effects.
-- The unique index makes re-import insert-or-skip on (org, shop, system, doc_no).

-- purchases (Phase 1)
alter table public.purchases add column if not exists source_system text;
alter table public.purchases add column if not exists source_doc_no text;
alter table public.purchases add column if not exists posts_effects boolean not null default true;
create unique index if not exists purchases_source_doc_idx
  on public.purchases (org_id, shop_id, source_system, source_doc_no)
  where source_doc_no is not null;

-- sales_invoices (pre-staged for Phase 2)
alter table public.sales_invoices add column if not exists source_system text;
alter table public.sales_invoices add column if not exists source_doc_no text;
alter table public.sales_invoices add column if not exists posts_effects boolean not null default true;
create unique index if not exists sales_invoices_source_doc_idx
  on public.sales_invoices (org_id, shop_id, source_system, source_doc_no)
  where source_doc_no is not null;

-- Note: credit_notes / debit_notes / payments get the same three columns + index
-- in their own phases (Returns, Payments). doctors table + doctor_id FK (ADR 0014)
-- ships with the Sales/H1 phase.
