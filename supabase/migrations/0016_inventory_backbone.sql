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
