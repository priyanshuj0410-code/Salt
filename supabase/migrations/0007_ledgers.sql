-- 0007: Ledgers (parties) — vendors, distributors, and customers — for the
-- Intelligent Importer's first cascade step. Per-org, deny-by-default RLS.
-- Run after 0002 (needs orgs + is_member).

create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  type text not null default 'customer' check (type in ('customer', 'supplier', 'both')),
  phone text,
  gstin text,
  address text,
  credit_limit_paise integer not null default 0,
  created_at timestamptz not null default now()
);

create index ledgers_org_idx on public.ledgers (org_id);

alter table public.ledgers enable row level security;

create policy "ledgers read"   on public.ledgers for select using (public.is_member(org_id));
create policy "ledgers insert" on public.ledgers for insert with check (public.is_member(org_id));
create policy "ledgers update" on public.ledgers for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "ledgers delete" on public.ledgers for delete using (public.is_member(org_id));
