-- 0012: Stable join keys for the cascade importer + GST place-of-supply.
--   * items.item_code  — the per-shop product code from Marg/Saral/Tally. The
--     item/HSN master and the stock report share this code (a clean 1:1 join),
--     so the stock step can link to items by code instead of fuzzy name match.
--     Unique per org only (codes collide across shops); enables upsert-on-code.
--   * ledgers.state_code / orgs.state_code — the party's and the shop's state.
--     Comparing them picks intra-state (CGST+SGST) vs inter-state (IGST) at
--     billing time. Sourced from the party GST master (STATECODE).
-- No RLS changes — both tables already gate every row on is_member(org_id).
-- Run in the Supabase SQL editor after 0011.

alter table public.items add column item_code text;

-- One product code per org. NOT partial — a partial index cannot be an upsert
-- ON CONFLICT target (PostgREST can't supply the WHERE predicate). NULL codes
-- stay unconstrained anyway: NULLs are distinct in a unique index, so items
-- without a code are still allowed; real codes are unique per org.
create unique index items_org_code_idx
  on public.items (org_id, item_code);

alter table public.ledgers add column state_code text;
alter table public.orgs    add column state_code text;
