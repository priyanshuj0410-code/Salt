-- 0031: Import extension for compliance history (Phase 6, SALT-152).
-- Adds source jsonb (verbatim imported row — the faithful-capture pattern, like
-- ledgers/items/batches in 0013) to the compliance tables so Smart Import can
-- archive the Schedule-H1 register, drug licences, filed GST returns, and
-- invoice-series continuity without dropping any column.
--
-- The tables themselves are already live (proposed 0022 gst_compliance / settings).
-- Additive only. Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Design: wiki/architecture/smart-import-extension.md.

alter table public.h1_register    add column if not exists source jsonb not null default '{}'::jsonb;
alter table public.drug_licenses  add column if not exists source jsonb not null default '{}'::jsonb;
alter table public.gst_returns    add column if not exists source jsonb not null default '{}'::jsonb;
alter table public.invoice_series add column if not exists source jsonb not null default '{}'::jsonb;
