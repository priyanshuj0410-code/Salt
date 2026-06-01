-- 0051: brand_aliases — de-identified brand -> composition/category crosswalk.
-- Complements the molecule-level master_items (0015): this brand-level table lets the
-- importer / "Fill from master" resolve a shop's brand SKU (e.g. "LONAZEP 0.5") to its
-- molecule ("Clonazepam 0.5mg") + therapeutic category, then chain into master_items for
-- HSN/GST. Follows the known_vendors / master_items model: any signed-in user may read;
-- writes happen via the seed migration (run as table owner, which bypasses RLS).
-- Seeded by 0052_seed_brand_aliases.sql (GENERATED from
-- supabase/seeds/master-items/brand_reference.csv by build_brand_aliases_seed.py).
-- Depends on: master_items (0015). Run after 0050, before 0052.

create table public.brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_key text not null,                  -- normalized join key: lower(), [^a-z0-9] stripped
  brand text not null,                      -- cleaned brand; strength kept, dosage form/pack stripped
  manufacturer text not null default '',    -- standardised maker; disambiguates shared brand stems
  composition text not null default '',     -- active molecule(s) + strength; '' when genuinely unknown
  category text not null default '',        -- therapeutic class
  confidence text not null default 'med'
    check (confidence in ('high-verified', 'high', 'med', 'low')),
  master_item_id uuid references public.master_items (id) on delete set null,  -- molecule link (filled later)
  source text not null default 'brand_reference',
  created_at timestamptz not null default now()
);

-- brand_key leads, so `where brand_key = $1` uses this; the full triple is the natural
-- key the seed dedups on, so it is also the on-conflict target (idempotent re-runs).
create unique index brand_aliases_key on public.brand_aliases (brand_key, manufacturer, composition);

alter table public.brand_aliases enable row level security;
create policy "brand_aliases read" on public.brand_aliases for select using (auth.role() = 'authenticated');
