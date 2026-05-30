-- 0013: Faithful capture — never discard a column from the customer's export.
-- The typed columns above hold what the app queries; `source` holds the
-- VERBATIM original row (every column, including fields we don't model yet:
-- Cost Price, Sales Price, Rack No., schemes, GST registration, party codes,
-- tax splits, …) so nothing is lost and it can be promoted to a typed column
-- later without re-importing. Applies to the three importer-written entities.
-- jsonb (not jsonb[]) — one row's worth per record. Run after 0012.

alter table public.ledgers add column source jsonb not null default '{}'::jsonb;
alter table public.items   add column source jsonb not null default '{}'::jsonb;
alter table public.batches add column source jsonb not null default '{}'::jsonb;
