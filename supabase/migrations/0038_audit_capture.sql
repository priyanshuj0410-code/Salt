-- 0038: Audit-log capture triggers + append-only lockdown (SALT-171).
-- SALT-092 shipped a read-only audit viewer over public.audit_log (live,
-- proposed/0023) but nothing wrote to it and it was not locked down. This:
--   1. adds a reusable AFTER INSERT/UPDATE/DELETE trigger that records a
--      before/after row on every change to the high-value tables;
--   2. makes audit_log truly append-only at the DB level (drop UPDATE/DELETE
--      policies + revoke those grants) so no client can rewrite history.
-- The viewer (created_at desc, resolves user via profiles) now has data.
-- Run after 0037.

-- 1. Reusable capture function ------------------------------------------------
-- SECURITY DEFINER so it can always write audit_log (even though clients lose
-- UPDATE/DELETE below). org_id/shop_id/row_id are derived generically from the
-- row via to_jsonb, so the same function serves every table; shop_id is null on
-- tables that have no such column. user_id = auth.uid() (the JWT sub is set
-- per-request and survives SECURITY DEFINER, so callers are still attributed).
create or replace function public.audit_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb; v_old jsonb; v_org uuid; v_shop uuid; v_row uuid;
begin
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  v_org  := coalesce(v_new->>'org_id',  v_old->>'org_id')::uuid;
  v_shop := coalesce(v_new->>'shop_id', v_old->>'shop_id')::uuid;
  v_row  := coalesce(v_new->>'id',      v_old->>'id')::uuid;
  if v_org is null then return null; end if;  -- only audit org-scoped rows
  insert into public.audit_log (org_id, shop_id, user_id, action, table_name, row_id, before, after)
  values (v_org, v_shop, auth.uid(), lower(tg_op), tg_table_name, v_row, v_old, v_new);
  return null;  -- AFTER trigger: return value is ignored
end; $$;

-- 2. Attach to the high-value tables (idempotent; skips any not yet present) ---
-- Deliberately NOT attached to audit_log itself (no recursion) nor to the
-- high-churn stock tables (batches/stock_movements already have their own ledger).
do $$
declare
  t text;
  tables text[] := array[
    'ledgers', 'items', 'sales_invoices', 'purchases', 'payments',
    'drug_licenses', 'shops', 'print_templates'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%s on public.%I', t, t);
      execute format(
        'create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.audit_capture()',
        t, t);
    end if;
  end loop;
end $$;

-- 3. Make audit_log append-only at the DB level -------------------------------
-- Keep the read + insert policies (the trigger/RPCs must be able to write);
-- drop UPDATE/DELETE policies so RLS denies any client mutation, and revoke the
-- grants as belt-and-suspenders. (service_role bypasses RLS for admin retention.)
drop policy if exists "audit_log update" on public.audit_log;
drop policy if exists "audit_log delete" on public.audit_log;
revoke update, delete on public.audit_log from authenticated;
