-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0014: Multi-shop foundation.
-- An org is the business/firm; a shop is a physical outlet under it. Stock and
-- every document become shop-scoped via shop_id, while RLS stays org-level
-- (is_member) — a member sees all shops in their org. Per-shop access control
-- for cashiers is a future hook (shop_members), enforced in RPCs, not RLS.
-- Depends on: orgs (0002), items/batches (0004), orders/order_lines (0010),
-- orgs.state_code (0012). Run after 0013.

-- 1. shops ----------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  code text,                       -- short label, e.g. "MAIN", "BR2"
  gstin text,                      -- a shop files GST under its own GSTIN
  state_code text,                 -- GST place-of-supply (origin) at billing time
  address text,
  phone text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- At most one primary shop per org (partial unique index).
create unique index shops_primary_per_org_idx on public.shops (org_id) where is_primary;
create index shops_org_idx on public.shops (org_id);

alter table public.shops enable row level security;
create policy "shops read"   on public.shops for select using (public.is_member(org_id));
create policy "shops insert" on public.shops for insert with check (public.is_member(org_id));
create policy "shops update" on public.shops for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "shops delete" on public.shops for delete using (public.is_member(org_id));

-- 2. shop_members: future hook to restrict a cashier to specific shops.
-- Not enforced by RLS in v1 (org membership still governs visibility); RPCs may
-- consult this to scope a session to one shop. No rows = access to all shops.
create table public.shop_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);
create index shop_members_user_idx on public.shop_members (user_id);

alter table public.shop_members enable row level security;
create policy "shop_members read"   on public.shop_members for select using (public.is_member(org_id));
create policy "shop_members insert" on public.shop_members for insert with check (public.is_member(org_id));
create policy "shop_members update" on public.shop_members for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "shop_members delete" on public.shop_members for delete using (public.is_member(org_id));

-- 3. Scope existing stock + documents to a shop --------------------------
-- Nullable for the backfill below; tighten to NOT NULL after promotion (see end).
alter table public.batches     add column shop_id uuid references public.shops (id) on delete cascade;
alter table public.orders      add column shop_id uuid references public.shops (id) on delete cascade;
alter table public.order_lines add column shop_id uuid references public.shops (id) on delete cascade;

create index batches_shop_idx on public.batches (shop_id);
create index orders_shop_idx  on public.orders (shop_id);

-- 4. New orgs get a primary shop. Preserves the one-org-per-user guard (0003).
-- (0017 redefines this again to also seed the chart of accounts.)
create or replace function public.create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  insert into public.orgs (name, created_by) values (p_name, auth.uid())
  returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');
  insert into public.shops (org_id, name, code, is_primary)
  values (new_org, p_name, 'MAIN', true);
  return new_org;
end; $$;

-- 5. Backfill: give every existing org a primary shop and attach its stock.
do $$
declare r record; v_shop uuid;
begin
  for r in select id, name, state_code from public.orgs loop
    select id into v_shop from public.shops where org_id = r.id and is_primary;
    if v_shop is null then
      insert into public.shops (org_id, name, code, state_code, is_primary)
      values (r.id, coalesce(r.name, 'Main shop'), 'MAIN', r.state_code, true)
      returning id into v_shop;
    end if;
    update public.batches     set shop_id = v_shop where org_id = r.id and shop_id is null;
    update public.orders      set shop_id = v_shop where org_id = r.id and shop_id is null;
    update public.order_lines set shop_id = v_shop where org_id = r.id and shop_id is null;
  end loop;
end $$;

-- After backfill, make shop scoping mandatory (uncomment at promotion):
-- alter table public.batches     alter column shop_id set not null;
-- alter table public.orders      alter column shop_id set not null;
-- alter table public.order_lines alter column shop_id set not null;
