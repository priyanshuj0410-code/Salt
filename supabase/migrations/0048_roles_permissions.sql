-- 0046: Roles & permissions (SALT-091 / SALT-174 model). RUN IN THE SUPABASE SQL EDITOR.
--
-- Widens user_role from (cashier, owner) to five roles, adds per-user permission
-- overrides on the membership, and ships owner-only RPCs to list + manage org
-- members. The memberships SELECT policy is self-only (0002), so listing members
-- needs a security-definer path rather than opening up RLS on memberships/profiles.
--
-- NOTE: the new enum values are only ever passed at call time (never used as a
-- literal in this migration), so there is no same-transaction enum-use problem.
--
-- Scope: this is the *model* + management RPCs. Role-aware RLS on the financial
-- tables (defence in depth beyond the app-layer capability gate) remains a
-- separate hardening pass.

-- 1. Widen the role enum -------------------------------------------------
alter type public.user_role add value if not exists 'manager';
alter type public.user_role add value if not exists 'pharmacist';
alter type public.user_role add value if not exists 'accountant';

-- 2. Per-user permission overrides --------------------------------------
-- Shape: { "grant": ["gst","reports"], "revoke": ["payments"] } — module keys
-- layered on the role's default module set (see apps/web/src/lib/permissions.ts).
alter table public.memberships
  add column if not exists permissions jsonb not null default '{}'::jsonb;

-- 3. Owner check helper --------------------------------------------------
create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and role = 'owner'
  );
$$;

-- 4. List the caller's org members (owner-only) --------------------------
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
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
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

-- 5. Set a member's role + overrides (owner-only) ------------------------
create or replace function public.set_member_role(
  p_user_id uuid, p_role public.user_role, p_permissions jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_owner_count int;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null or not public.is_org_owner(v_org) then
    raise exception 'only an owner can change roles';
  end if;
  -- Guard: never demote the last owner (covers demoting yourself).
  if p_role <> 'owner' then
    select count(*) into v_owner_count from public.memberships
      where org_id = v_org and role = 'owner';
    if v_owner_count <= 1 and exists (
      select 1 from public.memberships
      where org_id = v_org and user_id = p_user_id and role = 'owner'
    ) then
      raise exception 'cannot remove the last owner';
    end if;
  end if;
  update public.memberships
    set role = p_role, permissions = coalesce(p_permissions, permissions)
    where org_id = v_org and user_id = p_user_id;
  if not found then
    raise exception 'member not found in your organization';
  end if;
end; $$;
grant execute on function public.set_member_role(uuid, public.user_role, jsonb) to authenticated;
