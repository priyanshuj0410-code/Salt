-- 0002: Organizations + memberships (role lives on the membership).
-- Run in the Supabase SQL editor after 0001.

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.user_role not null default 'cashier',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;

-- Security-definer helper avoids RLS recursion between orgs and memberships.
create or replace function public.is_member(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create policy "members read their orgs" on public.orgs
  for select using (public.is_member(id));

create policy "read own memberships" on public.memberships
  for select using (user_id = auth.uid());

-- Create an org and make the caller its owner, atomically.
create or replace function public.create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  insert into public.orgs (name, created_by) values (p_name, auth.uid())
  returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');
  return new_org;
end; $$;
