-- 0015: Catalogue & drug master.
-- Extends the item master with retail/clinical fields, adds search aliases and
-- same-salt substitutes, and introduces a GLOBAL master_items reference (the
-- seeded national SKU DB) that org items can link to. master_items follows the
-- known_vendors model: any signed-in user may read; writes via a privileged job.
-- Depends on: orgs (0002), items (0004). Run after 0014.

-- 1. master_items: global, seeded drug/SKU reference (future-populated) -----
create table public.master_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  salt text,
  manufacturer text,
  pack text,
  hsn text,
  gst_rate numeric not null default 0,
  schedule text not null default 'OTC' check (schedule in ('OTC', 'H', 'H1', 'X')),
  barcode text,
  norm text,                       -- normalized name for fuzzy match (cf. known_vendors)
  source text default 'seed',
  created_at timestamptz not null default now()
);
create index master_items_norm_idx on public.master_items (norm);

alter table public.master_items enable row level security;
create policy "master_items read" on public.master_items for select using (auth.role() = 'authenticated');

-- 2. Extend the per-org item master --------------------------------------
alter table public.items
  add column is_active boolean not null default true,
  add column unit text,                          -- "strip", "bottle", "tube"
  add column pack_size numeric,                  -- units per pack (loose sale)
  add column reorder_level integer not null default 0,
  add column default_discount numeric not null default 0,
  add column therapeutic_category text,
  add column ayush_flag boolean not null default false,
  add column master_item_id uuid references public.master_items (id) on delete set null;

create index items_master_idx on public.items (master_item_id);

-- 3. item_aliases: alternate names/barcodes for fast counter lookup -------
create table public.item_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  alias text not null,
  kind text not null default 'synonym' check (kind in ('brand', 'salt', 'barcode', 'synonym')),
  created_at timestamptz not null default now()
);
create index item_aliases_org_idx   on public.item_aliases (org_id);
create index item_aliases_item_idx  on public.item_aliases (item_id);
create index item_aliases_alias_idx on public.item_aliases (org_id, lower(alias));

alter table public.item_aliases enable row level security;
create policy "item_aliases read"   on public.item_aliases for select using (public.is_member(org_id));
create policy "item_aliases insert" on public.item_aliases for insert with check (public.is_member(org_id));
create policy "item_aliases update" on public.item_aliases for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "item_aliases delete" on public.item_aliases for delete using (public.is_member(org_id));

-- 4. item_substitutes: same-salt alternatives ----------------------------
create table public.item_substitutes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  substitute_item_id uuid not null references public.items (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (item_id, substitute_item_id),
  check (item_id <> substitute_item_id)
);
create index item_substitutes_org_idx  on public.item_substitutes (org_id);
create index item_substitutes_item_idx on public.item_substitutes (item_id);

alter table public.item_substitutes enable row level security;
create policy "item_substitutes read"   on public.item_substitutes for select using (public.is_member(org_id));
create policy "item_substitutes insert" on public.item_substitutes for insert with check (public.is_member(org_id));
create policy "item_substitutes update" on public.item_substitutes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "item_substitutes delete" on public.item_substitutes for delete using (public.is_member(org_id));
