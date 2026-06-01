-- 0032: customer_group on ledgers — segment a party (Walk-in / Regular / Doctor /
-- Wholesale / Corporate) for filtering, reporting and group-level pricing.
-- Additive + nullable; existing rows read back null. RLS on ledgers (0007,
-- is_member(org_id)) covers the new column — no policy change. Run after 0008.
-- Closes SALT-156; unblocks parties SALT-048 (and SALT-050 group pricing).

alter table public.ledgers add column if not exists customer_group text;
