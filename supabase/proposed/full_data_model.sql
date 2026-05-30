-- Salt — full data model (proposed migrations 0014–0024), consolidated for one-shot apply.
-- Run in the Supabase SQL editor AFTER 0001–0013 are already applied. Additive: new
-- tables, RPCs, and views, plus safe (idempotent) backfills — a primary shop per org,
-- a seeded chart of accounts, and opening-balance ledger entries. The app keeps using
-- the existing tables until each module is wired to the new RPCs.
-- GENERATED from supabase/proposed/00NN_*.sql — edit those files, not this one.

-- ============================================================
-- 0014_shops.sql
-- ============================================================
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


-- ============================================================
-- 0015_catalogue.sql
-- ============================================================
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


-- ============================================================
-- 0016_inventory_backbone.sql
-- ============================================================
-- 0016: Inventory backbone — the stock ledger.
-- stock_movements is the immutable, signed audit trail of every quantity change.
-- batches.qty becomes a CACHED current-on-hand kept in step by the document RPCs
-- (0018-0020) that each write a movement row. All inventory reports (on-hand,
-- near-expiry, dead stock, valuation, variance) read from stock_movements.
-- Inter-shop transfers and physical counts also post movements.
-- Depends on: shops (0014), items/batches (0004). Run after 0015.

-- 0. Normalize batch expiry to a real date for FEFO / near-expiry SQL. The
-- captured free-text `expiry` (0004) is kept verbatim; expiry_date is the parsed
-- value the document RPCs and importer populate going forward.
alter table public.batches add column expiry_date date;
create index batches_expiry_idx on public.batches (expiry_date);

-- 1. stock_movements: the inventory ledger -------------------------------
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  qty_delta integer not null,                     -- signed: +in / -out
  reason text not null check (reason in (
    'sale', 'sale_return', 'purchase', 'purchase_return',
    'transfer_in', 'transfer_out', 'adjustment', 'writeoff', 'opening')),
  unit_cost_paise bigint not null default 0,      -- PTR/cost at movement time, for valuation
  ref_table text,                                 -- document type that caused it
  ref_id uuid,                                    -- document id
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index stock_movements_org_idx     on public.stock_movements (org_id);
create index stock_movements_shop_idx    on public.stock_movements (shop_id, created_at desc);
create index stock_movements_item_idx    on public.stock_movements (org_id, item_id);
create index stock_movements_batch_idx   on public.stock_movements (batch_id);
create index stock_movements_ref_idx     on public.stock_movements (ref_table, ref_id);

alter table public.stock_movements enable row level security;
create policy "stock_movements read"   on public.stock_movements for select using (public.is_member(org_id));
create policy "stock_movements insert" on public.stock_movements for insert with check (public.is_member(org_id));
create policy "stock_movements update" on public.stock_movements for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "stock_movements delete" on public.stock_movements for delete using (public.is_member(org_id));

-- 2. stock_transfers: move stock between shops in the same org -----------
-- Receiving a transfer posts two movements: transfer_out (from) + transfer_in (to).
create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  from_shop_id uuid not null references public.shops (id) on delete cascade,
  to_shop_id   uuid not null references public.shops (id) on delete cascade,
  transfer_no text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_shop_id <> to_shop_id)
);
create index stock_transfers_org_idx on public.stock_transfers (org_id);

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  qty integer not null default 0
);
create index stock_transfer_lines_transfer_idx on public.stock_transfer_lines (transfer_id);

alter table public.stock_transfers      enable row level security;
alter table public.stock_transfer_lines enable row level security;
create policy "stock_transfers read"   on public.stock_transfers for select using (public.is_member(org_id));
create policy "stock_transfers insert" on public.stock_transfers for insert with check (public.is_member(org_id));
create policy "stock_transfers update" on public.stock_transfers for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "stock_transfers delete" on public.stock_transfers for delete using (public.is_member(org_id));
create policy "stock_transfer_lines read"   on public.stock_transfer_lines for select using (public.is_member(org_id));
create policy "stock_transfer_lines insert" on public.stock_transfer_lines for insert with check (public.is_member(org_id));
create policy "stock_transfer_lines update" on public.stock_transfer_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "stock_transfer_lines delete" on public.stock_transfer_lines for delete using (public.is_member(org_id));

-- 3. physical_counts: stock-take reconciliation --------------------------
-- Finalizing posts an 'adjustment' movement per line for (counted - system).
create table public.physical_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  count_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index physical_counts_org_idx on public.physical_counts (org_id);

create table public.physical_count_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  count_id uuid not null references public.physical_counts (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete set null,
  system_qty integer not null default 0,
  counted_qty integer not null default 0,
  variance integer generated always as (counted_qty - system_qty) stored
);
create index physical_count_lines_count_idx on public.physical_count_lines (count_id);

alter table public.physical_counts      enable row level security;
alter table public.physical_count_lines enable row level security;
create policy "physical_counts read"   on public.physical_counts for select using (public.is_member(org_id));
create policy "physical_counts insert" on public.physical_counts for insert with check (public.is_member(org_id));
create policy "physical_counts update" on public.physical_counts for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "physical_counts delete" on public.physical_counts for delete using (public.is_member(org_id));
create policy "physical_count_lines read"   on public.physical_count_lines for select using (public.is_member(org_id));
create policy "physical_count_lines insert" on public.physical_count_lines for insert with check (public.is_member(org_id));
create policy "physical_count_lines update" on public.physical_count_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "physical_count_lines delete" on public.physical_count_lines for delete using (public.is_member(org_id));


-- ============================================================
-- 0017_accounting_backbone.sql
-- ============================================================
-- 0017: Accounting backbone — double-entry on a light chart of accounts.
-- Every document (sale, purchase, note, payment) posts balanced ledger_entries.
-- Party balance, trial balance, P&L, balance sheet, and GST liability all become
-- SUM() over ledger_entries. Party balances roll up to Sundry Debtors/Creditors
-- by ledgers.type in v_trial_balance (0023) — no control-account column needed.
-- Depends on: orgs (0002), ledgers (0007), shops (0014). Run after 0016.

-- 1. chart_accounts: the seeded chart -------------------------------------
create table public.chart_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'income', 'expense', 'equity')),
  parent_id uuid references public.chart_accounts (id) on delete set null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index chart_accounts_org_idx on public.chart_accounts (org_id);

alter table public.chart_accounts enable row level security;
create policy "chart_accounts read"   on public.chart_accounts for select using (public.is_member(org_id));
create policy "chart_accounts insert" on public.chart_accounts for insert with check (public.is_member(org_id));
create policy "chart_accounts update" on public.chart_accounts for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "chart_accounts delete" on public.chart_accounts for delete using (public.is_member(org_id));

-- 2. ledger_entries: the double-entry posting layer ----------------------
-- Exactly one of account_id / party_id is set; exactly one of debit/credit is nonzero.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  entry_date date not null default current_date,
  account_id uuid references public.chart_accounts (id) on delete restrict,
  party_id   uuid references public.ledgers (id) on delete restrict,
  debit_paise  bigint not null default 0,
  credit_paise bigint not null default 0,
  ref_table text,
  ref_id uuid,
  narration text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint ledger_entries_account_xor_party check ((account_id is not null) <> (party_id is not null)),
  constraint ledger_entries_dr_xor_cr check ((debit_paise = 0) <> (credit_paise = 0)),
  constraint ledger_entries_nonneg check (debit_paise >= 0 and credit_paise >= 0)
);
create index ledger_entries_account_idx on public.ledger_entries (org_id, account_id);
create index ledger_entries_party_idx   on public.ledger_entries (org_id, party_id);
create index ledger_entries_ref_idx     on public.ledger_entries (ref_table, ref_id);
create index ledger_entries_date_idx    on public.ledger_entries (org_id, entry_date);

alter table public.ledger_entries enable row level security;
create policy "ledger_entries read"   on public.ledger_entries for select using (public.is_member(org_id));
create policy "ledger_entries insert" on public.ledger_entries for insert with check (public.is_member(org_id));
create policy "ledger_entries update" on public.ledger_entries for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "ledger_entries delete" on public.ledger_entries for delete using (public.is_member(org_id));

-- 3. journal_vouchers: header for manual journal entries -----------------
create table public.journal_vouchers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  voucher_no text,
  voucher_date date not null default current_date,
  narration text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index journal_vouchers_org_idx on public.journal_vouchers (org_id);

alter table public.journal_vouchers enable row level security;
create policy "journal_vouchers read"   on public.journal_vouchers for select using (public.is_member(org_id));
create policy "journal_vouchers insert" on public.journal_vouchers for insert with check (public.is_member(org_id));
create policy "journal_vouchers update" on public.journal_vouchers for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "journal_vouchers delete" on public.journal_vouchers for delete using (public.is_member(org_id));

-- 4. seed_chart_of_accounts: the standard pharmacy COA -------------------
create or replace function public.seed_chart_of_accounts(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chart_accounts (org_id, code, name, type, is_system) values
    (p_org, 'CASH',       'Cash',                   'asset',     true),
    (p_org, 'BANK',       'Bank',                   'asset',     true),
    (p_org, 'DEBTORS',    'Sundry Debtors',         'asset',     true),
    (p_org, 'CREDITORS',  'Sundry Creditors',       'liability', true),
    (p_org, 'SALES',      'Sales',                  'income',    true),
    (p_org, 'SALES_RET',  'Sales Return',           'income',    true),
    (p_org, 'PURCHASE',   'Purchase',               'expense',   true),
    (p_org, 'PUR_RET',    'Purchase Return',        'expense',   true),
    (p_org, 'CGST_OUT',   'CGST Output',            'liability', true),
    (p_org, 'SGST_OUT',   'SGST Output',            'liability', true),
    (p_org, 'IGST_OUT',   'IGST Output',            'liability', true),
    (p_org, 'CGST_IN',    'CGST Input (ITC)',       'asset',     true),
    (p_org, 'SGST_IN',    'SGST Input (ITC)',       'asset',     true),
    (p_org, 'IGST_IN',    'IGST Input (ITC)',       'asset',     true),
    (p_org, 'DISC_ALLOW', 'Discount Allowed',       'expense',   true),
    (p_org, 'DISC_RECV',  'Discount Received',      'income',    true),
    (p_org, 'ROUNDOFF',   'Round Off',              'expense',   true),
    (p_org, 'OB_EQUITY',  'Opening Balance Equity', 'equity',    true)
  on conflict (org_id, code) do nothing;
end; $$;

-- Resolve a system account id by code — helper for the document RPCs (0018-0021).
create or replace function public.account_id(p_org uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.chart_accounts where org_id = p_org and code = p_code;
$$;

-- Post one side of a double entry; silently skips a fully-zero amount so callers
-- can pass e.g. igst=0 on an intra-state sale without tripping the dr/cr check.
create or replace function public.post_entry(
  p_org uuid, p_shop uuid, p_account uuid, p_party uuid,
  p_debit bigint, p_credit bigint, p_ref_table text, p_ref_id uuid, p_narration text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_debit, 0) = 0 and coalesce(p_credit, 0) = 0 then return; end if;
  insert into public.ledger_entries (
    org_id, shop_id, account_id, party_id, debit_paise, credit_paise, ref_table, ref_id, narration)
  values (
    p_org, p_shop, p_account, p_party, coalesce(p_debit, 0), coalesce(p_credit, 0), p_ref_table, p_ref_id, p_narration);
end; $$;

-- 5. New orgs seed a COA on creation. Preserves the 0003 guard + 0014 shop.
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
  perform public.seed_chart_of_accounts(new_org);
  return new_org;
end; $$;

-- 6. Backfill: seed a COA for every existing org, then post opening balances
--    as balanced entries (party side + Opening Balance Equity contra).
do $$
declare r record; v_shop uuid; v_obe uuid;
begin
  for r in select id from public.orgs loop
    perform public.seed_chart_of_accounts(r.id);
  end loop;

  for r in
    select id as ledger_id, org_id, opening_balance_paise
    from public.ledgers where opening_balance_paise <> 0
      and not exists (  -- idempotent: skip if this party already has an opening entry
        select 1 from public.ledger_entries le
        where le.party_id = public.ledgers.id and le.ref_table = 'opening')
  loop
    select id into v_shop from public.shops where org_id = r.org_id and is_primary;
    select id into v_obe  from public.chart_accounts where org_id = r.org_id and code = 'OB_EQUITY';
    -- + balance = receivable (Dr party); - balance = payable (Cr party).
    insert into public.ledger_entries (org_id, shop_id, party_id, debit_paise, credit_paise, ref_table, narration)
    values (r.org_id, v_shop, r.ledger_id,
            greatest(r.opening_balance_paise, 0), greatest(-r.opening_balance_paise, 0),
            'opening', 'Opening balance');
    -- Contra to Opening Balance Equity keeps the books balanced.
    insert into public.ledger_entries (org_id, shop_id, account_id, debit_paise, credit_paise, ref_table, narration)
    values (r.org_id, v_shop, v_obe,
            greatest(-r.opening_balance_paise, 0), greatest(r.opening_balance_paise, 0),
            'opening', 'Opening balance contra');
  end loop;
end $$;


-- ============================================================
-- 0018_sales.sql
-- ============================================================
-- 0018: Sales documents — invoices on the shared backbone.
-- Replaces the sale branch of orders/place_order. create_sales_invoice is the
-- authority for the GST split (CGST+SGST intra-state vs IGST inter-state, decided
-- by shop.state_code vs party.state_code), backs MRP-inclusive tax out of the line
-- total, moves stock via stock_movements (0016), and posts balanced double entries
-- (0017): Dr cash/bank or party = Cr Sales + Cr GST output.
-- Depends on: shops (0014), stock_movements (0016), accounting (0017), ledgers (0007).
-- Run after 0017.

-- 1. sales_invoices -------------------------------------------------------
create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null,  -- null = walk-in
  invoice_no text,
  invoice_date date not null default current_date,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  payment_method text,                       -- cash | card | upi | bank | credit
  credit_days integer,
  due_date date,
  is_interstate boolean not null default false,
  subtotal_paise bigint not null default 0,  -- tax-inclusive gross of all lines
  discount_paise bigint not null default 0,  -- bill-level discount (line discounts are in the lines)
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  doctor_name text,                          -- prescriber, for Schedule H/H1 sales
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index sales_invoices_org_created_idx on public.sales_invoices (org_id, created_at desc);
create index sales_invoices_shop_idx on public.sales_invoices (shop_id, invoice_date);
create index sales_invoices_party_idx on public.sales_invoices (party_id);

alter table public.sales_invoices enable row level security;
create policy "sales_invoices read"   on public.sales_invoices for select using (public.is_member(org_id));
create policy "sales_invoices insert" on public.sales_invoices for insert with check (public.is_member(org_id));
create policy "sales_invoices update" on public.sales_invoices for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "sales_invoices delete" on public.sales_invoices for delete using (public.is_member(org_id));

-- 2. sale_lines -----------------------------------------------------------
create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.sales_invoices (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  rate_paise bigint not null default 0,       -- MRP (tax-inclusive)
  discount_type text,
  discount_value numeric not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0, -- tax-inclusive, post-discount
  created_at timestamptz not null default now()
);
create index sale_lines_invoice_idx on public.sale_lines (invoice_id);
create index sale_lines_org_idx on public.sale_lines (org_id);

alter table public.sale_lines enable row level security;
create policy "sale_lines read"   on public.sale_lines for select using (public.is_member(org_id));
create policy "sale_lines insert" on public.sale_lines for insert with check (public.is_member(org_id));
create policy "sale_lines update" on public.sale_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "sale_lines delete" on public.sale_lines for delete using (public.is_member(org_id));

-- 3. create_sales_invoice -------------------------------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
--            discount_type, discount_value, gst_rate, line_total_paise}]
-- NOTE: the Schedule H1/X hard gate (require doctor + patient details) is wired
-- in 0022 once h1_register exists; this RPC already carries doctor_name.
create or replace function public.create_sales_invoice(
  p_shop_id uuid,
  p_party_id uuid,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_invoice_no text default null,
  p_doctor_name text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid;
  v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb;
  v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_gross bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
  v_cgst bigint; v_sgst bigint; v_igst bigint; v_cost bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
  v_paid bigint := 0; v_due date := null; v_pay_code text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;

  -- intra-state (CGST+SGST) unless the party is in a different state (IGST)
  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  if p_payment_method = 'cash' then v_pay_code := 'CASH';
  elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
  elsif p_payment_method = 'credit' then
    v_pay_code := null;
    if p_party_id is null then raise exception 'credit sale requires a party'; end if;
  else raise exception 'invalid payment method %', p_payment_method;
  end if;

  insert into public.sales_invoices (
    org_id, shop_id, party_id, invoice_no, status, payment_method, credit_days,
    is_interstate, doctor_name, notes, created_by
  ) values (
    v_org, p_shop_id, p_party_id, p_invoice_no, 'placed', p_payment_method, p_credit_days,
    not v_intra, p_doctor_name, p_notes, auth.uid()
  ) returning id into v_inv;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);

    -- back MRP-inclusive tax out of the gross line total
    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;  -- remainder to SGST
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;

    insert into public.sale_lines (
      org_id, invoice_id, item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
      discount_type, discount_value, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise
    ) values (
      v_org, v_inv, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, coalesce((v_line->>'rate_paise')::bigint, 0),
      v_line->>'discount_type', coalesce((v_line->>'discount_value')::numeric, 0),
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_gross
    );

    -- move stock from the matching batch (guarded against oversell) + log movement
    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty - v_qty
          where id = v_batch_id and org_id = v_org and qty >= v_qty
          returning ptr_paise into v_cost;
      else
        update public.batches set qty = qty - v_qty
          where org_id = v_org and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch_no, '') and qty >= v_qty
          returning id, ptr_paise into v_batch_id, v_cost;
      end if;
      if not found then
        raise exception 'insufficient stock for item % batch %', v_item, coalesce(v_batch_no, '');
      end if;

      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by
      ) values (
        v_org, p_shop_id, v_item, v_batch_id, -v_qty, 'sale', coalesce(v_cost, 0), 'sales_invoice', v_inv, auth.uid()
      );
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_gross;
  end loop;

  if v_pay_code is not null then
    v_paid := t_total;
  else
    v_paid := 0;
    if coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
  end if;

  update public.sales_invoices set
    subtotal_paise = t_total, taxable_paise = t_taxable,
    cgst_paise = t_cgst, sgst_paise = t_sgst, igst_paise = t_igst,
    total_paise = t_total, paid_paise = v_paid, due_date = v_due
  where id = v_inv;

  -- double entry: Dr cash/bank (paid) OR Dr party (credit) = Cr Sales + Cr GST output
  if v_pay_code is not null then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_pay_code), null, t_total, 0, 'sales_invoice', v_inv, 'Sale');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, t_total, 0, 'sales_invoice', v_inv, 'Credit sale');
  end if;
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SALES'),    null, 0, t_taxable, 'sales_invoice', v_inv, 'Sale');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_OUT'), null, 0, t_cgst, 'sales_invoice', v_inv, 'CGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_OUT'), null, 0, t_sgst, 'sales_invoice', v_inv, 'SGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_OUT'), null, 0, t_igst, 'sales_invoice', v_inv, 'IGST output');

  return v_inv;
end; $$;

grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, text, text) to authenticated;

-- 4. Cutover migration (run once, after the app switches to create_sales_invoice).
-- Copies sale history out of the unified orders table, preserving ids so /bills
-- links survive. Stock and ledgers are NOT re-posted here — batches.qty and party
-- balances already reflect these sales; historical postings are seeded separately
-- as opening stock_movements + balanced opening ledger_entries at cutover (see
-- wiki/decisions/0009). orders is dropped only after 0019 also migrates purchases.
insert into public.sales_invoices (
  id, org_id, shop_id, party_id, invoice_no, invoice_date, status, payment_method,
  credit_days, due_date, subtotal_paise, taxable_paise, total_paise, paid_paise, notes, created_at)
select o.id, o.org_id, o.shop_id, o.party_id, o.order_no, o.order_date, 'placed', o.payment_method,
  o.credit_days, o.due_date, o.total_paise, o.total_paise, o.total_paise, o.paid_paise, o.notes, o.created_at
from public.orders o where o.direction = 'sale'
on conflict (id) do nothing;

insert into public.sale_lines (
  id, org_id, invoice_id, item_id, name, batch_no, expiry, qty, rate_paise,
  discount_type, discount_value, taxable_paise, gst_rate, line_total_paise, created_at)
select ol.id, ol.org_id, ol.order_id, ol.item_id, ol.name, ol.batch_no, ol.expiry, ol.qty, ol.rate_paise,
  ol.discount_type, ol.discount_value, ol.line_total_paise, ol.gst_rate, ol.line_total_paise, ol.created_at
from public.order_lines ol
join public.orders o on o.id = ol.order_id and o.direction = 'sale'
on conflict (id) do nothing;


-- ============================================================
-- 0019_purchases.sql
-- ============================================================
-- 0019: Purchase documents — POs and GRNs on the shared backbone.
-- Replaces the purchase branch of orders/place_order. receive_purchase (a GRN)
-- upserts batches (qty + free goods into stock, refreshes ptr/mrp/expiry), logs a
-- 'purchase' stock movement (0016), and posts: Dr Purchase + Dr GST input (ITC) =
-- Cr vendor (or Cr cash/bank if paid). Purchase invoices are tax-EXCLUSIVE (GST on
-- top of PTR), unlike MRP-inclusive sales.
-- Depends on: shops (0014), stock_movements (0016), accounting (0017), ledgers (0007).
-- Run after 0018.
-- FOLLOW-UP: merge_ledgers (0009) must re-point purchases/ledger_entries before
-- deleting a merged vendor (vendor_id is RESTRICT here, by design).

-- 1. purchase_orders + po_lines (optional pre-GRN) -----------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  po_no text,
  po_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'received', 'closed', 'cancelled')),
  expected_date date,
  total_paise bigint not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index purchase_orders_org_idx on public.purchase_orders (org_id);
create index purchase_orders_vendor_idx on public.purchase_orders (vendor_id);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  qty integer not null default 0,
  ptr_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  line_total_paise bigint not null default 0
);
create index po_lines_po_idx on public.po_lines (po_id);

alter table public.purchase_orders enable row level security;
alter table public.po_lines        enable row level security;
create policy "purchase_orders read"   on public.purchase_orders for select using (public.is_member(org_id));
create policy "purchase_orders insert" on public.purchase_orders for insert with check (public.is_member(org_id));
create policy "purchase_orders update" on public.purchase_orders for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_orders delete" on public.purchase_orders for delete using (public.is_member(org_id));
create policy "po_lines read"   on public.po_lines for select using (public.is_member(org_id));
create policy "po_lines insert" on public.po_lines for insert with check (public.is_member(org_id));
create policy "po_lines update" on public.po_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "po_lines delete" on public.po_lines for delete using (public.is_member(org_id));

-- 2. purchases (GRN) + purchase_lines ------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  po_id uuid references public.purchase_orders (id) on delete set null,
  grn_no text,
  vendor_invoice_no text,
  vendor_invoice_date date,
  received_date date not null default current_date,
  is_interstate boolean not null default false,
  subtotal_paise bigint not null default 0,   -- sum of line taxable
  discount_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  status text not null default 'received' check (status in ('draft', 'received', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index purchases_org_created_idx on public.purchases (org_id, created_at desc);
create index purchases_shop_idx on public.purchases (shop_id, received_date);
create index purchases_vendor_idx on public.purchases (vendor_id);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  po_line_id uuid references public.po_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  free_qty integer not null default 0,        -- scheme goods (e.g. 10+1)
  ptr_paise bigint not null default 0,        -- cost per unit (tax-exclusive)
  mrp_paise bigint not null default 0,
  discount_type text,
  discount_value numeric not null default 0,
  scheme_text text,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0  -- taxable + tax
);
create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index purchase_lines_org_idx on public.purchase_lines (org_id);

alter table public.purchases      enable row level security;
alter table public.purchase_lines enable row level security;
create policy "purchases read"   on public.purchases for select using (public.is_member(org_id));
create policy "purchases insert" on public.purchases for insert with check (public.is_member(org_id));
create policy "purchases update" on public.purchases for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchases delete" on public.purchases for delete using (public.is_member(org_id));
create policy "purchase_lines read"   on public.purchase_lines for select using (public.is_member(org_id));
create policy "purchase_lines insert" on public.purchase_lines for insert with check (public.is_member(org_id));
create policy "purchase_lines update" on public.purchase_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_lines delete" on public.purchase_lines for delete using (public.is_member(org_id));

-- 3. receive_purchase (GRN) ----------------------------------------------
-- p_lines: [{item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, mrp_paise,
--            discount_type, discount_value, gst_rate, taxable_paise, scheme_text}]
create or replace function public.receive_purchase(
  p_shop_id uuid,
  p_vendor_id uuid,
  p_vendor_invoice_no text,
  p_vendor_invoice_date date,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_po_id uuid default null,
  p_grn_no text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_grn uuid;
  v_intra boolean; v_shop_state text; v_vendor_state text;
  v_line jsonb;
  v_item uuid; v_batch_no text; v_qty integer; v_free integer; v_stock_qty integer;
  v_ptr bigint; v_mrp bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
  v_cgst bigint; v_sgst bigint; v_igst bigint; v_batch_id uuid;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
  v_paid bigint := 0; v_due date := null; v_pay_code text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  select state_code into v_vendor_state from public.ledgers where id = p_vendor_id and org_id = v_org;
  if not found then raise exception 'vendor not in organization'; end if;

  v_intra := (v_vendor_state is null) or (v_vendor_state = v_shop_state);

  if p_payment_method = 'cash' then v_pay_code := 'CASH';
  elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
  elsif p_payment_method = 'credit' then v_pay_code := null;
  else raise exception 'invalid payment method %', p_payment_method;
  end if;

  insert into public.purchases (
    org_id, shop_id, vendor_id, po_id, grn_no, vendor_invoice_no, vendor_invoice_date,
    is_interstate, notes, created_by
  ) values (
    v_org, p_shop_id, p_vendor_id, p_po_id, p_grn_no, p_vendor_invoice_no, p_vendor_invoice_date,
    not v_intra, p_notes, auth.uid()
  ) returning id into v_grn;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_free := coalesce((v_line->>'free_qty')::integer, 0);
    v_ptr := coalesce((v_line->>'ptr_paise')::bigint, 0);
    v_mrp := coalesce((v_line->>'mrp_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    -- taxable is tax-exclusive: take it if supplied, else qty * ptr
    v_taxable := coalesce(nullif((v_line->>'taxable_paise'), '')::bigint, v_qty * v_ptr);
    v_tax := round(v_taxable * v_rate / 100.0);
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;

    insert into public.purchase_lines (
      org_id, purchase_id, item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, mrp_paise,
      discount_type, discount_value, scheme_text, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise
    ) values (
      v_org, v_grn, v_item, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, v_free, v_ptr, v_mrp,
      v_line->>'discount_type', coalesce((v_line->>'discount_value')::numeric, 0), v_line->>'scheme_text',
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_taxable + v_tax
    );

    -- add stock: free goods land in stock too (effective cost spreads over qty+free)
    v_stock_qty := v_qty + v_free;
    if v_item is not null and v_stock_qty > 0 then
      update public.batches set
        qty = qty + v_stock_qty,
        ptr_paise = coalesce(nullif(v_ptr, 0)::integer, ptr_paise),
        mrp_paise = coalesce(nullif(v_mrp, 0)::integer, mrp_paise),
        expiry = coalesce(nullif(v_line->>'expiry', ''), expiry)
        where org_id = v_org and shop_id = p_shop_id and item_id = v_item
          and coalesce(batch_no, '') = coalesce(v_batch_no, '')
        returning id into v_batch_id;
      if not found then
        insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
        values (v_org, p_shop_id, v_item, v_batch_no, nullif(v_line->>'expiry', ''), v_stock_qty, v_mrp::integer, v_ptr::integer)
        returning id into v_batch_id;
      end if;

      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by
      ) values (
        v_org, p_shop_id, v_item, v_batch_id, v_stock_qty, 'purchase', v_ptr, 'purchase', v_grn, auth.uid()
      );
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_taxable + v_tax;
  end loop;

  if v_pay_code is not null then
    v_paid := t_total;
  else
    v_paid := 0;
    if coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
  end if;

  update public.purchases set
    subtotal_paise = t_taxable, taxable_paise = t_taxable,
    cgst_paise = t_cgst, sgst_paise = t_sgst, igst_paise = t_igst,
    total_paise = t_total, paid_paise = v_paid
  where id = v_grn;

  if p_po_id is not null then
    update public.purchase_orders set status = 'received' where id = p_po_id and org_id = v_org;
  end if;

  -- double entry: Dr Purchase + Dr GST input (ITC) = Cr vendor (or Cr cash/bank if paid)
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'PURCHASE'), null, t_taxable, 0, 'purchase', v_grn, 'Purchase');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_IN'), null, t_cgst, 0, 'purchase', v_grn, 'CGST input');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_IN'), null, t_sgst, 0, 'purchase', v_grn, 'SGST input');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_IN'), null, t_igst, 0, 'purchase', v_grn, 'IGST input');
  if v_pay_code is not null then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_pay_code), null, 0, t_total, 'purchase', v_grn, 'Purchase paid');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_vendor_id, 0, t_total, 'purchase', v_grn, 'Purchase on credit');
  end if;

  return v_grn;
end; $$;

grant execute on function public.receive_purchase(uuid, uuid, text, date, text, integer, jsonb, uuid, text, text) to authenticated;

-- 4. Cutover migration (run once at cutover; see 0018 note on history/postings).
insert into public.purchases (
  id, org_id, shop_id, vendor_id, grn_no, received_date, status,
  subtotal_paise, taxable_paise, total_paise, paid_paise, notes, created_at)
select o.id, o.org_id, o.shop_id, o.party_id, o.order_no, o.order_date, 'received',
  o.total_paise, o.total_paise, o.total_paise, o.paid_paise, o.notes, o.created_at
from public.orders o
where o.direction = 'purchase' and o.party_id is not null
on conflict (id) do nothing;

insert into public.purchase_lines (
  id, org_id, purchase_id, item_id, name, batch_no, expiry, qty, ptr_paise,
  discount_type, discount_value, taxable_paise, gst_rate, line_total_paise)
select ol.id, ol.org_id, ol.order_id, ol.item_id, ol.name, ol.batch_no, ol.expiry, ol.qty, ol.rate_paise,
  ol.discount_type, ol.discount_value, ol.line_total_paise, ol.gst_rate, ol.line_total_paise
from public.order_lines ol
join public.orders o on o.id = ol.order_id and o.direction = 'purchase' and o.party_id is not null
on conflict (id) do nothing;


-- ============================================================
-- 0020_returns.sql
-- ============================================================
-- 0020: Returns & notes.
--   credit_notes = sales return: stock back in, reverse Sales + GST output, Cr party/cash.
--   debit_notes  = purchase/expiry return to vendor: stock out, reverse Purchase +
--                  GST input (ITC reversal), Dr vendor.
-- Both reuse the GST-split + double-entry pattern of 0018/0019, reversed.
-- Depends on: sales (0018), purchases (0019), accounting (0017). Run after 0019.

-- 1. credit_notes (sales return) -----------------------------------------
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null,
  sale_invoice_id uuid references public.sales_invoices (id) on delete set null,
  note_no text,
  note_date date not null default current_date,
  reason text,
  is_interstate boolean not null default false,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  total_paise bigint not null default 0,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index credit_notes_org_idx on public.credit_notes (org_id, created_at desc);
create index credit_notes_party_idx on public.credit_notes (party_id);

create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes (id) on delete cascade,
  sale_line_id uuid references public.sale_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  rate_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0
);
create index credit_note_lines_note_idx on public.credit_note_lines (credit_note_id);

-- 2. debit_notes (purchase / expiry return) ------------------------------
create table public.debit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  purchase_id uuid references public.purchases (id) on delete set null,
  note_no text,
  note_date date not null default current_date,
  reason text,
  is_interstate boolean not null default false,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  itc_reversal_paise bigint not null default 0,
  total_paise bigint not null default 0,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index debit_notes_org_idx on public.debit_notes (org_id, created_at desc);
create index debit_notes_vendor_idx on public.debit_notes (vendor_id);

create table public.debit_note_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  debit_note_id uuid not null references public.debit_notes (id) on delete cascade,
  purchase_line_id uuid references public.purchase_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  ptr_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0
);
create index debit_note_lines_note_idx on public.debit_note_lines (debit_note_id);

-- RLS for all four tables (standard per-org gate) ------------------------
alter table public.credit_notes      enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.debit_notes       enable row level security;
alter table public.debit_note_lines  enable row level security;
create policy "credit_notes read"   on public.credit_notes for select using (public.is_member(org_id));
create policy "credit_notes insert" on public.credit_notes for insert with check (public.is_member(org_id));
create policy "credit_notes update" on public.credit_notes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "credit_notes delete" on public.credit_notes for delete using (public.is_member(org_id));
create policy "credit_note_lines read"   on public.credit_note_lines for select using (public.is_member(org_id));
create policy "credit_note_lines insert" on public.credit_note_lines for insert with check (public.is_member(org_id));
create policy "credit_note_lines update" on public.credit_note_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "credit_note_lines delete" on public.credit_note_lines for delete using (public.is_member(org_id));
create policy "debit_notes read"   on public.debit_notes for select using (public.is_member(org_id));
create policy "debit_notes insert" on public.debit_notes for insert with check (public.is_member(org_id));
create policy "debit_notes update" on public.debit_notes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "debit_notes delete" on public.debit_notes for delete using (public.is_member(org_id));
create policy "debit_note_lines read"   on public.debit_note_lines for select using (public.is_member(org_id));
create policy "debit_note_lines insert" on public.debit_note_lines for insert with check (public.is_member(org_id));
create policy "debit_note_lines update" on public.debit_note_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "debit_note_lines delete" on public.debit_note_lines for delete using (public.is_member(org_id));

-- 3. create_credit_note (sales return) -----------------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, expiry, qty, rate_paise, gst_rate, line_total_paise}]
-- p_refund_mode: 'cash' | 'bank' | 'credit' (credit = reduce the party's receivable)
create or replace function public.create_credit_note(
  p_shop_id uuid, p_party_id uuid, p_sale_invoice_id uuid, p_reason text,
  p_refund_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_gross bigint; v_rate numeric; v_taxable bigint; v_tax bigint; v_cgst bigint; v_sgst bigint; v_igst bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;
  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;
  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  insert into public.credit_notes (org_id, shop_id, party_id, sale_invoice_id, note_no, reason, is_interstate, notes, created_by)
  values (v_org, p_shop_id, p_party_id, p_sale_invoice_id, p_note_no, p_reason, not v_intra, p_notes, auth.uid())
  returning id into v_note;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.credit_note_lines (
      org_id, credit_note_id, item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
      taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    values (v_org, v_note, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, coalesce((v_line->>'rate_paise')::bigint, 0), v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_gross);

    -- stock back in
    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty + v_qty where id = v_batch_id and org_id = v_org returning id into v_batch_id;
      else
        update public.batches set qty = qty + v_qty
          where org_id = v_org and shop_id = p_shop_id and item_id = v_item and coalesce(batch_no, '') = coalesce(v_batch_no, '')
          returning id into v_batch_id;
      end if;
      if not found then
        insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, qty)
        values (v_org, p_shop_id, v_item, v_batch_no, nullif(v_line->>'expiry', ''), v_qty) returning id into v_batch_id;
      end if;
      insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, ref_table, ref_id, created_by)
      values (v_org, p_shop_id, v_item, v_batch_id, v_qty, 'sale_return', 'credit_note', v_note, auth.uid());
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_gross;
  end loop;

  update public.credit_notes set taxable_paise = t_taxable, cgst_paise = t_cgst, sgst_paise = t_sgst,
    igst_paise = t_igst, total_paise = t_total where id = v_note;

  -- reverse the sale: Dr Sales Return + Dr GST output = Cr party (or refund cash/bank)
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SALES_RET'), null, t_taxable, 0, 'credit_note', v_note, 'Sales return');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_OUT'), null, t_cgst, 0, 'credit_note', v_note, 'CGST output reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_OUT'), null, t_sgst, 0, 'credit_note', v_note, 'SGST output reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_OUT'), null, t_igst, 0, 'credit_note', v_note, 'IGST output reversal');
  if p_refund_mode = 'cash' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CASH'), null, 0, t_total, 'credit_note', v_note, 'Cash refund');
  elsif p_refund_mode = 'bank' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'BANK'), null, 0, t_total, 'credit_note', v_note, 'Bank refund');
  else
    if p_party_id is null then raise exception 'credit-mode return requires a party'; end if;
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, 0, t_total, 'credit_note', v_note, 'Return to party account');
  end if;

  return v_note;
end; $$;

grant execute on function public.create_credit_note(uuid, uuid, uuid, text, text, jsonb, text, text) to authenticated;

-- 4. create_debit_note (purchase / expiry return) ------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, qty, ptr_paise, gst_rate, taxable_paise}]
-- p_settle_mode: 'cash' | 'bank' | 'credit' (credit = reduce the vendor payable)
create or replace function public.create_debit_note(
  p_shop_id uuid, p_vendor_id uuid, p_purchase_id uuid, p_reason text,
  p_settle_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_vendor_state text;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_ptr bigint; v_rate numeric; v_taxable bigint; v_tax bigint; v_cgst bigint; v_sgst bigint; v_igst bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;
  select state_code into v_vendor_state from public.ledgers where id = p_vendor_id and org_id = v_org;
  if not found then raise exception 'vendor not in organization'; end if;
  v_intra := (v_vendor_state is null) or (v_vendor_state = v_shop_state);

  insert into public.debit_notes (org_id, shop_id, vendor_id, purchase_id, note_no, reason, is_interstate, notes, created_by)
  values (v_org, p_shop_id, p_vendor_id, p_purchase_id, p_note_no, p_reason, not v_intra, p_notes, auth.uid())
  returning id into v_note;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_ptr := coalesce((v_line->>'ptr_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    v_taxable := coalesce(nullif((v_line->>'taxable_paise'), '')::bigint, v_qty * v_ptr);
    v_tax := round(v_taxable * v_rate / 100.0);
    if v_intra then v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.debit_note_lines (
      org_id, debit_note_id, item_id, batch_id, name, batch_no, qty, ptr_paise,
      taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    values (v_org, v_note, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_qty, v_ptr,
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_taxable + v_tax);

    -- stock out (guarded)
    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty - v_qty where id = v_batch_id and org_id = v_org and qty >= v_qty returning id into v_batch_id;
      else
        update public.batches set qty = qty - v_qty
          where org_id = v_org and shop_id = p_shop_id and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch_no, '') and qty >= v_qty
          returning id into v_batch_id;
      end if;
      if not found then raise exception 'insufficient stock to return for item %', v_item; end if;
      insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by)
      values (v_org, p_shop_id, v_item, v_batch_id, -v_qty, 'purchase_return', v_ptr, 'debit_note', v_note, auth.uid());
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_taxable + v_tax;
  end loop;

  update public.debit_notes set taxable_paise = t_taxable, cgst_paise = t_cgst, sgst_paise = t_sgst,
    igst_paise = t_igst, itc_reversal_paise = t_cgst + t_sgst + t_igst, total_paise = t_total where id = v_note;

  -- reverse the purchase: Dr vendor (or cash/bank) = Cr Purchase Return + Cr GST input (ITC reversal)
  if p_settle_mode = 'cash' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CASH'), null, t_total, 0, 'debit_note', v_note, 'Vendor cash refund');
  elsif p_settle_mode = 'bank' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'BANK'), null, t_total, 0, 'debit_note', v_note, 'Vendor bank refund');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_vendor_id, t_total, 0, 'debit_note', v_note, 'Reduce vendor payable');
  end if;
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'PUR_RET'), null, 0, t_taxable, 'debit_note', v_note, 'Purchase return');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_IN'), null, 0, t_cgst, 'debit_note', v_note, 'CGST ITC reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_IN'), null, 0, t_sgst, 'debit_note', v_note, 'SGST ITC reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_IN'), null, 0, t_igst, 'debit_note', v_note, 'IGST ITC reversal');

  return v_note;
end; $$;

grant execute on function public.create_debit_note(uuid, uuid, uuid, text, text, jsonb, text, text) to authenticated;


-- ============================================================
-- 0021_payments.sql
-- ============================================================
-- 0021: Payments & receipts.
-- record_payment posts the cash/bank <-> party double entry and optionally allocates
-- the amount across specific open bills. 'received' = money in from a customer
-- (Dr cash/bank, Cr party); 'paid' = money out to a vendor (Dr party, Cr cash/bank).
-- cash_drawer and bank_statement_lines are hooks for shift reconciliation / bank rec.
-- Depends on: accounting (0017), ledgers (0007), shops (0014). Run after 0020.

-- 1. payments + allocations ----------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid not null references public.ledgers (id) on delete restrict,
  direction text not null check (direction in ('received', 'paid')),
  payment_date date not null default current_date,
  mode text not null check (mode in ('cash', 'upi', 'card', 'cheque', 'bank', 'adjustment')),
  amount_paise bigint not null default 0,
  reference text,                                  -- UTR / cheque no / txn id
  bank_account_id uuid references public.chart_accounts (id) on delete set null,
  notes text,
  status text not null default 'cleared' check (status in ('pending', 'cleared', 'bounced')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index payments_org_idx on public.payments (org_id, payment_date desc);
create index payments_party_idx on public.payments (party_id);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  target_table text not null check (target_table in ('sales_invoice', 'purchase', 'ledger_bill')),
  target_id uuid not null,
  allocated_paise bigint not null default 0,
  created_at timestamptz not null default now()
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_target_idx on public.payment_allocations (target_table, target_id);

alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
create policy "payments read"   on public.payments for select using (public.is_member(org_id));
create policy "payments insert" on public.payments for insert with check (public.is_member(org_id));
create policy "payments update" on public.payments for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "payments delete" on public.payments for delete using (public.is_member(org_id));
create policy "payment_allocations read"   on public.payment_allocations for select using (public.is_member(org_id));
create policy "payment_allocations insert" on public.payment_allocations for insert with check (public.is_member(org_id));
create policy "payment_allocations update" on public.payment_allocations for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "payment_allocations delete" on public.payment_allocations for delete using (public.is_member(org_id));

-- 2. record_payment ------------------------------------------------------
-- p_allocations: optional [{target_table, target_id, allocated_paise}]
create or replace function public.record_payment(
  p_shop_id uuid, p_party_id uuid, p_direction text, p_mode text, p_amount_paise bigint,
  p_reference text default null, p_allocations jsonb default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_pay uuid; v_cash_code text; v_alloc jsonb;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.shops where id = p_shop_id and org_id = v_org) then
    raise exception 'shop not in organization'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = v_org) then
    raise exception 'party not in organization'; end if;
  if p_direction not in ('received', 'paid') then raise exception 'invalid direction %', p_direction; end if;
  if p_mode = 'cash' then v_cash_code := 'CASH';
  elsif p_mode in ('upi', 'card', 'cheque', 'bank') then v_cash_code := 'BANK';
  else raise exception 'mode % must be posted via a journal voucher, not record_payment', p_mode;
  end if;

  insert into public.payments (org_id, shop_id, party_id, direction, mode, amount_paise, reference, notes, created_by)
  values (v_org, p_shop_id, p_party_id, p_direction, p_mode, p_amount_paise, p_reference, p_notes, auth.uid())
  returning id into v_pay;

  if p_allocations is not null then
    insert into public.payment_allocations (org_id, payment_id, target_table, target_id, allocated_paise)
    select v_org, v_pay, a->>'target_table', (a->>'target_id')::uuid, coalesce((a->>'allocated_paise')::bigint, 0)
    from jsonb_array_elements(p_allocations) a;
  end if;

  -- double entry
  if p_direction = 'received' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_cash_code), null, p_amount_paise, 0, 'payment', v_pay, 'Receipt');
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, 0, p_amount_paise, 'payment', v_pay, 'Receipt from party');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, p_amount_paise, 0, 'payment', v_pay, 'Payment to party');
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_cash_code), null, 0, p_amount_paise, 'payment', v_pay, 'Payment');
  end if;

  return v_pay;
end; $$;

grant execute on function public.record_payment(uuid, uuid, text, text, bigint, text, jsonb, text) to authenticated;

-- 3. cash_drawer: per-shift cash reconciliation (hook) -------------------
create table public.cash_drawer (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shift_date date not null default current_date,
  opened_by uuid references auth.users (id),
  opening_paise bigint not null default 0,
  closing_paise bigint,
  expected_paise bigint,                          -- derived from CASH movements during the shift
  variance_paise bigint,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index cash_drawer_shop_idx on public.cash_drawer (shop_id, shift_date);

-- 4. bank_statement_lines: imported lines for bank reconciliation (hook) --
create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  bank_account_id uuid references public.chart_accounts (id) on delete set null,
  txn_date date,
  amount_paise bigint not null default 0,          -- signed: +credit / -debit
  description text,
  reference text,
  matched_entry_id uuid references public.ledger_entries (id) on delete set null,
  created_at timestamptz not null default now()
);
create index bank_statement_lines_org_idx on public.bank_statement_lines (org_id, txn_date);

alter table public.cash_drawer          enable row level security;
alter table public.bank_statement_lines enable row level security;
create policy "cash_drawer read"   on public.cash_drawer for select using (public.is_member(org_id));
create policy "cash_drawer insert" on public.cash_drawer for insert with check (public.is_member(org_id));
create policy "cash_drawer update" on public.cash_drawer for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "cash_drawer delete" on public.cash_drawer for delete using (public.is_member(org_id));
create policy "bank_statement_lines read"   on public.bank_statement_lines for select using (public.is_member(org_id));
create policy "bank_statement_lines insert" on public.bank_statement_lines for insert with check (public.is_member(org_id));
create policy "bank_statement_lines update" on public.bank_statement_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "bank_statement_lines delete" on public.bank_statement_lines for delete using (public.is_member(org_id));


-- ============================================================
-- 0022_gst_compliance.sql
-- ============================================================
-- 0022: GST & compliance.
-- Filing periods + GSTR-2B reconciliation + the Schedule H1/X register + drug
-- licenses. GSTR-1/3B/ITC are VIEWS derived from the document tables and the
-- ledger, not stored. Views use security_invoker so per-org RLS still applies.
-- Depends on: sales (0018), purchases (0019), returns (0020), items (0004). Run after 0021.

-- 1. gst_returns: a filing period's lock/status --------------------------
create table public.gst_returns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,  -- null = org-consolidated
  period text not null,                              -- 'YYYY-MM'
  return_type text not null check (return_type in ('GSTR1', 'GSTR3B')),
  status text not null default 'draft' check (status in ('draft', 'filed')),
  filed_at timestamptz,
  summary jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (org_id, shop_id, period, return_type)
);
create index gst_returns_org_idx on public.gst_returns (org_id, period);

-- 2. GSTR-2B import + reconciliation against purchases -------------------
create table public.gstr2b_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  period text not null,
  filename text,
  imported_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create table public.gstr2b_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  import_id uuid not null references public.gstr2b_imports (id) on delete cascade,
  vendor_gstin text,
  invoice_no text,
  invoice_date date,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0
);
create table public.gstr2b_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  gstr2b_line_id uuid not null references public.gstr2b_lines (id) on delete cascade,
  purchase_id uuid references public.purchases (id) on delete set null,
  match_status text not null check (match_status in ('matched', 'mismatch', 'missing_in_books', 'missing_in_2b')),
  variance_paise bigint not null default 0,
  created_at timestamptz not null default now()
);
create index gstr2b_lines_import_idx on public.gstr2b_lines (import_id);
create index gstr2b_matches_line_idx on public.gstr2b_matches (gstr2b_line_id);

-- 3. h1_register: Schedule H1/X dispensing log --------------------------
create table public.h1_register (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_invoice_id uuid references public.sales_invoices (id) on delete set null,
  sale_line_id uuid references public.sale_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  drug_name text not null,
  schedule text not null check (schedule in ('H', 'H1', 'X')),
  batch_no text,
  expiry text,
  qty integer not null default 0,
  doctor_name text,
  doctor_reg_no text,
  patient_name text,
  patient_address text,
  pharmacist_id uuid references auth.users (id),
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index h1_register_org_idx on public.h1_register (org_id, sold_at desc);
create index h1_register_invoice_idx on public.h1_register (sale_invoice_id);

-- 4. drug_licenses: store licenses + renewal tracking -------------------
create table public.drug_licenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  license_type text not null,                        -- '20' | '21' | '20B' | '21B' | 'Form 20F' ...
  license_no text not null,
  holder_name text,
  issued_date date,
  expiry_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index drug_licenses_org_idx on public.drug_licenses (org_id);
create index drug_licenses_expiry_idx on public.drug_licenses (expiry_date);

-- RLS for all compliance tables -----------------------------------------
alter table public.gst_returns    enable row level security;
alter table public.gstr2b_imports enable row level security;
alter table public.gstr2b_lines   enable row level security;
alter table public.gstr2b_matches enable row level security;
alter table public.h1_register    enable row level security;
alter table public.drug_licenses  enable row level security;
create policy "gst_returns read"   on public.gst_returns for select using (public.is_member(org_id));
create policy "gst_returns insert" on public.gst_returns for insert with check (public.is_member(org_id));
create policy "gst_returns update" on public.gst_returns for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gst_returns delete" on public.gst_returns for delete using (public.is_member(org_id));
create policy "gstr2b_imports read"   on public.gstr2b_imports for select using (public.is_member(org_id));
create policy "gstr2b_imports insert" on public.gstr2b_imports for insert with check (public.is_member(org_id));
create policy "gstr2b_imports update" on public.gstr2b_imports for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_imports delete" on public.gstr2b_imports for delete using (public.is_member(org_id));
create policy "gstr2b_lines read"   on public.gstr2b_lines for select using (public.is_member(org_id));
create policy "gstr2b_lines insert" on public.gstr2b_lines for insert with check (public.is_member(org_id));
create policy "gstr2b_lines update" on public.gstr2b_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_lines delete" on public.gstr2b_lines for delete using (public.is_member(org_id));
create policy "gstr2b_matches read"   on public.gstr2b_matches for select using (public.is_member(org_id));
create policy "gstr2b_matches insert" on public.gstr2b_matches for insert with check (public.is_member(org_id));
create policy "gstr2b_matches update" on public.gstr2b_matches for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_matches delete" on public.gstr2b_matches for delete using (public.is_member(org_id));
create policy "h1_register read"   on public.h1_register for select using (public.is_member(org_id));
create policy "h1_register insert" on public.h1_register for insert with check (public.is_member(org_id));
create policy "h1_register update" on public.h1_register for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "h1_register delete" on public.h1_register for delete using (public.is_member(org_id));
create policy "drug_licenses read"   on public.drug_licenses for select using (public.is_member(org_id));
create policy "drug_licenses insert" on public.drug_licenses for insert with check (public.is_member(org_id));
create policy "drug_licenses update" on public.drug_licenses for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "drug_licenses delete" on public.drug_licenses for delete using (public.is_member(org_id));

-- 5. Schedule H1/X hard gate --------------------------------------------
-- record_h1_entry logs a dispensing; enforce_h1_gate fails an invoice that sold
-- a H1/X item without a complete register entry (doctor + patient details).
create or replace function public.record_h1_entry(
  p_shop_id uuid, p_sale_invoice_id uuid, p_sale_line_id uuid, p_item_id uuid,
  p_drug_name text, p_schedule text, p_batch_no text, p_expiry text, p_qty integer,
  p_doctor_name text, p_doctor_reg_no text, p_patient_name text, p_patient_address text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if p_schedule in ('H1', 'X') and (coalesce(p_doctor_name, '') = '' or coalesce(p_patient_name, '') = '' or coalesce(p_patient_address, '') = '') then
    raise exception 'Schedule % requires doctor name, patient name and address', p_schedule;
  end if;
  insert into public.h1_register (
    org_id, shop_id, sale_invoice_id, sale_line_id, item_id, drug_name, schedule,
    batch_no, expiry, qty, doctor_name, doctor_reg_no, patient_name, patient_address, pharmacist_id)
  values (v_org, p_shop_id, p_sale_invoice_id, p_sale_line_id, p_item_id, p_drug_name, p_schedule,
    p_batch_no, p_expiry, p_qty, p_doctor_name, p_doctor_reg_no, p_patient_name, p_patient_address, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.record_h1_entry(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, text, text, text) to authenticated;

-- Raises if any H1/X line on the invoice lacks a register entry. Wire into
-- create_sales_invoice (0018) by adding `perform public.enforce_h1_gate(v_inv);`
-- just before `return v_inv;` (and pass patient details via record_h1_entry in
-- the same transaction). Kept as a separate function to avoid duplicating the
-- whole 0018 RPC body in this draft.
create or replace function public.enforce_h1_gate(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.sale_lines sl
    join public.items i on i.id = sl.item_id
    where sl.invoice_id = p_invoice and i.schedule in ('H1', 'X')
      and not exists (select 1 from public.h1_register h where h.sale_line_id = sl.id)
  ) then
    raise exception 'Schedule H1/X items on this invoice need a completed H1 register entry';
  end if;
end; $$;

-- 6. Derived GST views (starting points; refine column mapping at build time) ---
create view public.v_gstr1_b2b with (security_invoker = true) as
  select si.org_id, to_char(si.invoice_date, 'YYYY-MM') as period,
    l.gstin as party_gstin, l.name as party_name,
    sum(si.taxable_paise) as taxable_paise, sum(si.cgst_paise) as cgst_paise,
    sum(si.sgst_paise) as sgst_paise, sum(si.igst_paise) as igst_paise, sum(si.total_paise) as total_paise
  from public.sales_invoices si join public.ledgers l on l.id = si.party_id
  where l.gstin is not null and si.status = 'placed'
  group by si.org_id, to_char(si.invoice_date, 'YYYY-MM'), l.gstin, l.name;

create view public.v_gstr1_b2c with (security_invoker = true) as
  select si.org_id, to_char(si.invoice_date, 'YYYY-MM') as period, si.is_interstate,
    sum(si.taxable_paise) as taxable_paise, sum(si.cgst_paise) as cgst_paise,
    sum(si.sgst_paise) as sgst_paise, sum(si.igst_paise) as igst_paise, sum(si.total_paise) as total_paise
  from public.sales_invoices si
  left join public.ledgers l on l.id = si.party_id
  where (si.party_id is null or l.gstin is null) and si.status = 'placed'
  group by si.org_id, to_char(si.invoice_date, 'YYYY-MM'), si.is_interstate;

create view public.v_gstr1_hsn with (security_invoker = true) as
  select sl.org_id, to_char(si.invoice_date, 'YYYY-MM') as period,
    i.hsn, sl.gst_rate,
    sum(sl.qty) as qty, sum(sl.taxable_paise) as taxable_paise,
    sum(sl.cgst_paise) as cgst_paise, sum(sl.sgst_paise) as sgst_paise, sum(sl.igst_paise) as igst_paise
  from public.sale_lines sl
  join public.sales_invoices si on si.id = sl.invoice_id
  left join public.items i on i.id = sl.item_id
  where si.status = 'placed'
  group by sl.org_id, to_char(si.invoice_date, 'YYYY-MM'), i.hsn, sl.gst_rate;

create view public.v_itc_register with (security_invoker = true) as
  select p.org_id, to_char(p.received_date, 'YYYY-MM') as period,
    sum(p.cgst_paise) as cgst_in_paise, sum(p.sgst_paise) as sgst_in_paise, sum(p.igst_paise) as igst_in_paise
  from public.purchases p where p.status = 'received'
  group by p.org_id, to_char(p.received_date, 'YYYY-MM');

create view public.v_gstr3b_summary with (security_invoker = true) as
  select org_id, period,
    sum(out_taxable) as outward_taxable_paise, sum(out_cgst) as out_cgst_paise,
    sum(out_sgst) as out_sgst_paise, sum(out_igst) as out_igst_paise,
    sum(in_cgst) as itc_cgst_paise, sum(in_sgst) as itc_sgst_paise, sum(in_igst) as itc_igst_paise
  from (
    select org_id, to_char(invoice_date, 'YYYY-MM') as period,
      taxable_paise as out_taxable, cgst_paise as out_cgst, sgst_paise as out_sgst, igst_paise as out_igst,
      0::bigint as in_cgst, 0::bigint as in_sgst, 0::bigint as in_igst
    from public.sales_invoices where status = 'placed'
    union all
    select org_id, to_char(received_date, 'YYYY-MM') as period,
      0, 0, 0, 0, cgst_paise, sgst_paise, igst_paise
    from public.purchases where status = 'received'
  ) u
  group by org_id, period;


-- ============================================================
-- 0023_reports.sql
-- ============================================================
-- 0023: Reports & analytics — derived views over the two backbones, plus a
-- general audit log. Views use security_invoker so per-org RLS still applies.
-- On-hand reads the batches cache; the audit trail and financials read the
-- stock_movements / ledger_entries ledgers. These are starting points to refine.
-- Depends on: stock_movements (0016), accounting (0017), documents (0018-0021). Run after 0022.

-- 1. Inventory views -----------------------------------------------------
create view public.v_stock_on_hand with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, b.id as batch_id,
    b.batch_no, b.expiry_date, b.qty, b.mrp_paise, b.ptr_paise,
    (b.qty * b.ptr_paise) as stock_value_paise
  from public.batches b join public.items i on i.id = b.item_id
  where b.qty <> 0;

create view public.v_near_expiry with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, b.batch_no, b.expiry_date, b.qty,
    (b.expiry_date - current_date) as days_to_expiry,
    case
      when b.expiry_date < current_date then 'expired'
      when b.expiry_date <= current_date + 30 then '0-30'
      when b.expiry_date <= current_date + 60 then '31-60'
      when b.expiry_date <= current_date + 90 then '61-90'
      else '90+'
    end as bucket,
    (b.qty * b.ptr_paise) as stock_value_paise
  from public.batches b join public.items i on i.id = b.item_id
  where b.qty > 0 and b.expiry_date is not null;

-- Items in stock with no sale movement in the last 90 days (or ever).
create view public.v_dead_stock with (security_invoker = true) as
  select b.org_id, b.shop_id, b.item_id, i.name as item_name, sum(b.qty) as qty,
    sum(b.qty * b.ptr_paise) as stock_value_paise, max(sm.last_sale) as last_sold_at
  from public.batches b
  join public.items i on i.id = b.item_id
  left join (
    select item_id, shop_id, max(created_at) as last_sale
    from public.stock_movements where reason = 'sale' group by item_id, shop_id
  ) sm on sm.item_id = b.item_id and sm.shop_id = b.shop_id
  where b.qty > 0
  group by b.org_id, b.shop_id, b.item_id, i.name
  having max(sm.last_sale) is null or max(sm.last_sale) < now() - interval '90 days';

-- 2. Document registers --------------------------------------------------
create view public.v_sales_register with (security_invoker = true) as
  select si.org_id, si.shop_id, si.id, si.invoice_no, si.invoice_date, si.party_id,
    coalesce(l.name, 'Walk-in') as party_name, si.is_interstate,
    si.taxable_paise, si.cgst_paise, si.sgst_paise, si.igst_paise, si.total_paise, si.paid_paise, si.status
  from public.sales_invoices si left join public.ledgers l on l.id = si.party_id;

create view public.v_purchase_register with (security_invoker = true) as
  select p.org_id, p.shop_id, p.id, p.grn_no, p.vendor_invoice_no, p.received_date,
    p.vendor_id, l.name as vendor_name, p.is_interstate,
    p.taxable_paise, p.cgst_paise, p.sgst_paise, p.igst_paise, p.total_paise, p.paid_paise, p.status
  from public.purchases p join public.ledgers l on l.id = p.vendor_id;

-- 3. Aging (from unpaid documents) --------------------------------------
create view public.v_receivables_aging with (security_invoker = true) as
  select si.org_id, si.party_id, l.name as party_name,
    sum(si.total_paise - si.paid_paise) as outstanding_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) <= 30 then si.total_paise - si.paid_paise else 0 end) as d0_30_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) between 31 and 60 then si.total_paise - si.paid_paise else 0 end) as d31_60_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) between 61 and 90 then si.total_paise - si.paid_paise else 0 end) as d61_90_paise,
    sum(case when current_date - coalesce(si.due_date, si.invoice_date) > 90 then si.total_paise - si.paid_paise else 0 end) as d90_plus_paise
  from public.sales_invoices si join public.ledgers l on l.id = si.party_id
  where si.total_paise > si.paid_paise
  group by si.org_id, si.party_id, l.name;

create view public.v_payables_aging with (security_invoker = true) as
  select p.org_id, p.vendor_id, l.name as vendor_name,
    sum(p.total_paise - p.paid_paise) as outstanding_paise,
    sum(case when current_date - p.received_date <= 30 then p.total_paise - p.paid_paise else 0 end) as d0_30_paise,
    sum(case when current_date - p.received_date between 31 and 60 then p.total_paise - p.paid_paise else 0 end) as d31_60_paise,
    sum(case when current_date - p.received_date between 61 and 90 then p.total_paise - p.paid_paise else 0 end) as d61_90_paise,
    sum(case when current_date - p.received_date > 90 then p.total_paise - p.paid_paise else 0 end) as d90_plus_paise
  from public.purchases p join public.ledgers l on l.id = p.vendor_id
  where p.total_paise > p.paid_paise
  group by p.org_id, p.vendor_id, l.name;

-- 4. Financials (from the double-entry ledger) --------------------------
-- One row per account and per party. A balanced book sums balance_paise to 0.
create view public.v_trial_balance with (security_invoker = true) as
  select le.org_id, 'account'::text as kind, ca.code, ca.name, ca.type,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where le.account_id is not null
  group by le.org_id, ca.code, ca.name, ca.type
  union all
  select le.org_id, 'party'::text as kind, null as code, l.name,
    case when l.type = 'vendor' then 'liability' else 'asset' end as type,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.ledgers l on l.id = le.party_id
  where le.party_id is not null
  group by le.org_id, l.name, l.type;

create view public.v_pnl with (security_invoker = true) as
  select le.org_id, ca.type, ca.code, ca.name,
    sum(le.credit_paise) - sum(le.debit_paise) as amount_paise   -- income +, expense -
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where ca.type in ('income', 'expense')
  group by le.org_id, ca.type, ca.code, ca.name;

create view public.v_balance_sheet with (security_invoker = true) as
  select le.org_id, ca.type, ca.code, ca.name,
    sum(le.debit_paise) - sum(le.credit_paise) as balance_paise
  from public.ledger_entries le join public.chart_accounts ca on ca.id = le.account_id
  where ca.type in ('asset', 'liability', 'equity')
  group by le.org_id, ca.type, ca.code, ca.name;

-- 5. audit_log: general before/after trail (beyond stock_movements) -----
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  user_id uuid references auth.users (id),
  action text not null,                         -- insert | update | delete | custom
  table_name text,
  row_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
create policy "audit_log read"   on public.audit_log for select using (public.is_member(org_id));
create policy "audit_log insert" on public.audit_log for insert with check (public.is_member(org_id));
create policy "audit_log update" on public.audit_log for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "audit_log delete" on public.audit_log for delete using (public.is_member(org_id));


-- ============================================================
-- 0024_settings.sql
-- ============================================================
-- 0024: Settings + forward hooks.
-- Invoice numbering per shop/series, print templates, org/shop settings, salesmen,
-- and thin Tier-4 stub tables (ABHA patients, purchase-OCR, ONDC, B2B) so those
-- features never force a core rewrite. The stubs are intentionally minimal and
-- NOT wired to anything in v1.
-- Depends on: shops (0014), sales_invoices (0018). Run after 0023.

-- 1. invoice_series + next_doc_no ----------------------------------------
create table public.invoice_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  doc_type text not null check (doc_type in ('sales_invoice', 'purchase', 'credit_note', 'debit_note', 'payment')),
  prefix text,
  next_number integer not null default 1,
  financial_year text not null,                     -- '2025-26'
  unique (org_id, shop_id, doc_type, financial_year)
);
create index invoice_series_org_idx on public.invoice_series (org_id);

-- Atomically allocate the next number for a (shop, doc_type) in the current FY.
create or replace function public.next_doc_no(p_shop uuid, p_doc_type text)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_prefix text; v_num integer; v_fy text; v_yr integer;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  v_yr := extract(year from current_date)::integer;
  -- Indian FY runs Apr-Mar.
  if extract(month from current_date) >= 4 then
    v_fy := v_yr || '-' || lpad(((v_yr + 1) % 100)::text, 2, '0');
  else
    v_fy := (v_yr - 1) || '-' || lpad((v_yr % 100)::text, 2, '0');
  end if;
  update public.invoice_series set next_number = next_number + 1
    where org_id = v_org and shop_id = p_shop and doc_type = p_doc_type and financial_year = v_fy
    returning prefix, next_number - 1 into v_prefix, v_num;
  if not found then
    insert into public.invoice_series (org_id, shop_id, doc_type, prefix, next_number, financial_year)
    values (v_org, p_shop, p_doc_type, upper(left(p_doc_type, 3)), 2, v_fy)
    returning prefix, 1 into v_prefix, v_num;
  end if;
  return coalesce(v_prefix, '') || '/' || v_fy || '/' || lpad(v_num::text, 5, '0');
end; $$;
grant execute on function public.next_doc_no(uuid, text) to authenticated;

-- 2. print_templates -----------------------------------------------------
create table public.print_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  doc_type text not null,
  name text not null,
  format text not null default 'a4' check (format in ('thermal', 'a4', 'dotmatrix')),
  template jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index print_templates_org_idx on public.print_templates (org_id);

-- 3. org_settings / shop_settings (one jsonb blob per scope) -------------
create table public.org_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.shop_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 4. salesmen (wholesale) ------------------------------------------------
create table public.salesmen (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  phone text,
  territory text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index salesmen_org_idx on public.salesmen (org_id);
alter table public.sales_invoices add column salesman_id uuid references public.salesmen (id) on delete set null;

-- 5. Tier-4 forward hooks (thin; not wired in v1) ------------------------
create table public.patients (                       -- ABHA / ABDM linkage
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  phone text,
  abha_id text,
  address text,
  created_at timestamptz not null default now()
);
create table public.purchase_ocr_jobs (             -- AI purchase-invoice capture
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  file_url text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  extracted jsonb,
  created_at timestamptz not null default now()
);
create table public.ondc_listings (                 -- ONDC catalogue publish
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  item_id uuid references public.items (id) on delete cascade,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
create table public.b2b_connections (               -- ERP-to-ERP ordering
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  partner_org_id uuid,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- RLS for every table in this file --------------------------------------
alter table public.invoice_series   enable row level security;
alter table public.print_templates  enable row level security;
alter table public.org_settings     enable row level security;
alter table public.shop_settings    enable row level security;
alter table public.salesmen         enable row level security;
alter table public.patients         enable row level security;
alter table public.purchase_ocr_jobs enable row level security;
alter table public.ondc_listings    enable row level security;
alter table public.b2b_connections  enable row level security;

create policy "invoice_series read"   on public.invoice_series for select using (public.is_member(org_id));
create policy "invoice_series insert" on public.invoice_series for insert with check (public.is_member(org_id));
create policy "invoice_series update" on public.invoice_series for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "invoice_series delete" on public.invoice_series for delete using (public.is_member(org_id));
create policy "print_templates read"   on public.print_templates for select using (public.is_member(org_id));
create policy "print_templates insert" on public.print_templates for insert with check (public.is_member(org_id));
create policy "print_templates update" on public.print_templates for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "print_templates delete" on public.print_templates for delete using (public.is_member(org_id));
create policy "org_settings read"   on public.org_settings for select using (public.is_member(org_id));
create policy "org_settings insert" on public.org_settings for insert with check (public.is_member(org_id));
create policy "org_settings update" on public.org_settings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org_settings delete" on public.org_settings for delete using (public.is_member(org_id));
create policy "shop_settings read"   on public.shop_settings for select using (public.is_member(org_id));
create policy "shop_settings insert" on public.shop_settings for insert with check (public.is_member(org_id));
create policy "shop_settings update" on public.shop_settings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "shop_settings delete" on public.shop_settings for delete using (public.is_member(org_id));
create policy "salesmen read"   on public.salesmen for select using (public.is_member(org_id));
create policy "salesmen insert" on public.salesmen for insert with check (public.is_member(org_id));
create policy "salesmen update" on public.salesmen for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "salesmen delete" on public.salesmen for delete using (public.is_member(org_id));
create policy "patients read"   on public.patients for select using (public.is_member(org_id));
create policy "patients insert" on public.patients for insert with check (public.is_member(org_id));
create policy "patients update" on public.patients for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "patients delete" on public.patients for delete using (public.is_member(org_id));
create policy "purchase_ocr_jobs read"   on public.purchase_ocr_jobs for select using (public.is_member(org_id));
create policy "purchase_ocr_jobs insert" on public.purchase_ocr_jobs for insert with check (public.is_member(org_id));
create policy "purchase_ocr_jobs update" on public.purchase_ocr_jobs for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_ocr_jobs delete" on public.purchase_ocr_jobs for delete using (public.is_member(org_id));
create policy "ondc_listings read"   on public.ondc_listings for select using (public.is_member(org_id));
create policy "ondc_listings insert" on public.ondc_listings for insert with check (public.is_member(org_id));
create policy "ondc_listings update" on public.ondc_listings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "ondc_listings delete" on public.ondc_listings for delete using (public.is_member(org_id));
create policy "b2b_connections read"   on public.b2b_connections for select using (public.is_member(org_id));
create policy "b2b_connections insert" on public.b2b_connections for insert with check (public.is_member(org_id));
create policy "b2b_connections update" on public.b2b_connections for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "b2b_connections delete" on public.b2b_connections for delete using (public.is_member(org_id));

