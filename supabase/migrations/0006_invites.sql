-- 0006: Team invites. An owner generates a short, single-use, expiring code;
-- a new user redeems it during onboarding to join the org with the code's role.
-- No email service needed (codes are shared out-of-band). Run after 0003.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  code text not null unique,
  role public.user_role not null default 'cashier',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users (id)
);

alter table public.invites enable row level security;

-- Owners can view their org's invites (creation/redemption go through RPCs).
create policy "owners read invites" on public.invites
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = invites.org_id and m.user_id = auth.uid() and m.role = 'owner'
    )
  );

-- Owner creates an invite for their org.
create or replace function public.create_invite(p_role public.user_role default 'cashier')
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  select org_id into v_org from public.memberships
   where user_id = auth.uid() and role = 'owner' limit 1;
  if v_org is null then
    raise exception 'Only an org owner can create invites';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invites (org_id, code, role, created_by)
  values (v_org, v_code, p_role, auth.uid());
  return v_code;
end; $$;

-- Redeem an invite: the caller joins the org with the code's role.
create or replace function public.redeem_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role public.user_role;
begin
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  select org_id, role into v_org, v_role from public.invites
   where code = upper(p_code) and used_at is null and expires_at > now();
  if v_org is null then
    raise exception 'Invalid, expired, or already-used invite code';
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), v_role);
  update public.invites set used_at = now(), used_by = auth.uid() where code = upper(p_code);
  return jsonb_build_object('org_id', v_org, 'role', v_role);
end; $$;

grant execute on function public.create_invite(public.user_role) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
