-- 0043: Widen the membership role enum from {cashier, owner} to the five-role
-- model (SALT-174): add manager, pharmacist, accountant.
--
-- IMPORTANT: run this migration FIRST and on its own, and let it commit before
-- running 0044. Postgres forbids USING a freshly added enum value inside the
-- same transaction that added it, so the enum change must land separately.
--
-- Append-only: no value is reordered or removed, so existing 'cashier'/'owner'
-- rows are untouched — there is no data backfill and no lockout. profiles.role,
-- memberships.role and invites.role all share public.user_role and pick up the
-- new values automatically.

alter type public.user_role add value if not exists 'manager';
alter type public.user_role add value if not exists 'pharmacist';
alter type public.user_role add value if not exists 'accountant';
