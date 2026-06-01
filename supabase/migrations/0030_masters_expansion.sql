-- 0030: Masters expansion for Smart Import (Phase 5, SALT-151).
--   * doctors master (ADR 0014) — identity registration_no -> name.
--   * doctor_id FK on the prescriber-bearing documents (h1_register, sales_invoices),
--     nullable; the existing doctor_name text stays for display / unresolved prescribers.
--   * source jsonb on salesmen so imported masters keep their verbatim source row
--     (the faithful-capture pattern — ledgers/items/batches got it in 0013; shops
--     already has it).
--
-- Additive on top of the applied model + 0025/0026/0029. Run once in the Supabase
-- SQL editor. Idempotent — safe to re-run.
-- Design: wiki/architecture/smart-import-extension.md · ADR 0014 (doctors master).

-- 1. doctors master ------------------------------------------------------
create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  registration_no text,                            -- identity key (reg-no -> name)
  phone text,
  is_active boolean not null default true,
  source jsonb not null default '{}'::jsonb,        -- verbatim imported row
  created_at timestamptz not null default now()
);
create index if not exists doctors_org_idx on public.doctors (org_id);

alter table public.doctors enable row level security;
drop policy if exists "doctors read"   on public.doctors;
drop policy if exists "doctors insert" on public.doctors;
drop policy if exists "doctors update" on public.doctors;
drop policy if exists "doctors delete" on public.doctors;
create policy "doctors read"   on public.doctors for select using (public.is_member(org_id));
create policy "doctors insert" on public.doctors for insert with check (public.is_member(org_id));
create policy "doctors update" on public.doctors for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "doctors delete" on public.doctors for delete using (public.is_member(org_id));

-- 2. doctor_id FK on prescriber-bearing documents (nullable) -------------
alter table public.h1_register   add column if not exists doctor_id uuid references public.doctors (id) on delete set null;
alter table public.sales_invoices add column if not exists doctor_id uuid references public.doctors (id) on delete set null;

-- 3. Faithful-capture column on salesmen ---------------------------------
alter table public.salesmen add column if not exists source jsonb not null default '{}'::jsonb;
