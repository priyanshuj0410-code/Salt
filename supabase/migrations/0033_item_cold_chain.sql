-- 0033: Cold-chain flag on the item master (SALT-045).
-- Marks items that need temperature-controlled storage (insulin, vaccines,
-- some biologics) — the hook for near-future IoT temperature logging and for
-- surfacing cold-chain handling at GRN / billing. Defaults false.
-- Run in the Supabase SQL editor. The catalogue UI degrades gracefully if this
-- has not been run yet (it falls back to selecting without the column), but the
-- cold-chain flag stays read-only/false until it is applied.

alter table public.items
  add column if not exists cold_chain boolean not null default false;
