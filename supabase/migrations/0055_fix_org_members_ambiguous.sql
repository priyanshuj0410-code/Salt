-- 0055: Fix `org_members()` — "column reference user_id is ambiguous". RUN IN THE SUPABASE SQL EDITOR.
--
-- 0048 declared `org_members()` with `RETURNS TABLE (user_id uuid, …)`, which puts an OUT
-- parameter named `user_id` in scope inside the body. The bootstrap lookup
-- `select org_id into v_org from public.memberships where user_id = auth.uid()` then has an
-- ambiguous `user_id` (OUT param vs column), so the RPC errored at call time and Settings →
-- Roles & permissions showed "column reference user_id is ambiguous".
--
-- Fix: alias the table and qualify the column. `create or replace` re-defines the function in
-- place (no data change, safe to re-run). `set_member_role` is unaffected (no OUT table).

create or replace function public.org_members()
returns table (
  user_id uuid,
  role public.user_role,
  permissions jsonb,
  full_name text,
  email text,
  is_self boolean,
  created_at timestamptz
) language plpgsql security definer set search_path = public stable as $$
declare v_org uuid;
begin
  select m.org_id into v_org from public.memberships m where m.user_id = auth.uid() limit 1;
  if v_org is null then return; end if;
  if not public.is_org_owner(v_org) then
    raise exception 'only an owner can list members';
  end if;
  return query
    select m.user_id, m.role, m.permissions, p.full_name, p.email,
           (m.user_id = auth.uid()) as is_self, m.created_at
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    where m.org_id = v_org
    order by m.created_at asc;
end; $$;
grant execute on function public.org_members() to authenticated;
