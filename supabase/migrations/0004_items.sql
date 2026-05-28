-- 0004: Item master + batch stock, physically scoped to an org via org_id and
-- isolated with deny-by-default RLS. A user can only read/write rows for orgs
-- they belong to (is_member from 0002 is security-definer, so no RLS recursion).
-- Run in the Supabase SQL editor after 0003.

create table public.items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  salt text,
  manufacturer text,
  pack text,
  hsn text,
  gst_rate numeric not null default 0,
  schedule text not null default 'OTC' check (schedule in ('OTC', 'H', 'H1', 'X')),
  barcode text,
  created_at timestamptz not null default now()
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  mrp_paise integer not null default 0,
  ptr_paise integer not null default 0,
  created_at timestamptz not null default now()
);

create index items_org_idx on public.items (org_id);
create index batches_org_idx on public.batches (org_id);
create index batches_item_idx on public.batches (item_id);

alter table public.items enable row level security;
alter table public.batches enable row level security;

-- Items: full access only within the user's org.
create policy "items read"   on public.items for select using (public.is_member(org_id));
create policy "items insert" on public.items for insert with check (public.is_member(org_id));
create policy "items update" on public.items for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "items delete" on public.items for delete using (public.is_member(org_id));

-- Batches: same per-org gate.
create policy "batches read"   on public.batches for select using (public.is_member(org_id));
create policy "batches insert" on public.batches for insert with check (public.is_member(org_id));
create policy "batches update" on public.batches for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "batches delete" on public.batches for delete using (public.is_member(org_id));
