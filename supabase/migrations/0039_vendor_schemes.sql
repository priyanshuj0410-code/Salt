-- 0039: Vendor schemes — the per-vendor deal log (SALT-026). A scheme is a
-- standing arrangement a distributor offers: a trade discount and/or a free-goods
-- ratio, optionally scoped to one item, optionally time-boxed. The GRN entry
-- screen reads the active scheme for a (vendor, item) and auto-applies it to the
-- line (trade discount % / flat, scheme free qty), flagging when what was keyed
-- differs from what the vendor agreed. Pure reference data: it moves no stock and
-- posts no accounting, so a plain org-scoped table with deny-by-default RLS is
-- enough (same shape as items, 0004) — no RPC. Run in the Supabase SQL editor.

create table public.vendor_schemes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete cascade,
  -- Null item = a vendor-wide scheme (applies to every line from this vendor);
  -- a set item_id scopes the scheme to that product (takes precedence on match).
  item_id uuid references public.items (id) on delete cascade,
  -- Free-text label for the deal, e.g. "10+1 on Augmentin", "2% CD".
  label text,
  -- Trade discount applied to the line: 'pct' (% of gross) or 'flat' (paise/line).
  -- Null discount_type = no discount component (free-goods-only scheme).
  discount_type text check (discount_type in ('pct', 'flat')),
  discount_value numeric not null default 0,
  -- Free-goods ratio: buy `scheme_buy_qty`, get `scheme_free_qty` free
  -- (the 10+1 pattern → buy 10, free 1). Both 0 = no free goods.
  scheme_buy_qty integer not null default 0,
  scheme_free_qty integer not null default 0,
  -- Optional validity window; null = open-ended. Inclusive dates.
  valid_from date,
  valid_to date,
  active boolean not null default true,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index vendor_schemes_org_idx on public.vendor_schemes (org_id);
create index vendor_schemes_vendor_idx on public.vendor_schemes (vendor_id);
create index vendor_schemes_item_idx on public.vendor_schemes (item_id);

alter table public.vendor_schemes enable row level security;

-- Per-org gate, deny-by-default (mirrors items/batches in 0004).
create policy "vendor_schemes read"   on public.vendor_schemes for select using (public.is_member(org_id));
create policy "vendor_schemes insert" on public.vendor_schemes for insert with check (public.is_member(org_id));
create policy "vendor_schemes update" on public.vendor_schemes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "vendor_schemes delete" on public.vendor_schemes for delete using (public.is_member(org_id));
