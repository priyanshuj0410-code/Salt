-- 0035: customer_group segment tag on ledgers (SALT-156).
-- One additive, nullable column so the owner can group parties for filtering,
-- reporting, and group-level pricing. Unblocks parties SALT-048 (groups UI) and
-- SALT-050 (group pricing); also serves as the party "group" scope for price
-- rules (SALT-010). No backfill, no policy change — ledgers already gates every
-- op on is_member(org_id) (migration 0007), and the new column inherits that.
-- Soft CHECK: null or one of the five agreed segments (lowercase). Run after 0034.

alter table public.ledgers
  add column if not exists customer_group text
  check (customer_group is null or customer_group in ('walk-in', 'regular', 'doctor', 'wholesale', 'corporate'));
