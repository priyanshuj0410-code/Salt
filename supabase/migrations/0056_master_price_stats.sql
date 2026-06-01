-- 0056: master_price_stats — cross-shop crowd-sourced PTR/MRP into the master (SALT-182).
-- The network-effects moat. SALT-082 showed each shop its OWN PTR/MRP from purchase_lines; this
-- aggregates ACROSS all orgs into anonymized medians keyed by master_item_id, so a shop can see the
-- crowd median next to its own. PRIVACY: aggregates only, min-N orgs gate (>= 3) so no single shop's
-- price is identifiable; raw cross-org rows are NEVER returned to a client. The cross-org read happens
-- only inside a SECURITY DEFINER refresh function (admin-gated); clients get authenticated READ of the
-- aggregate table.
-- Depends on: master_items (0015), items (0004), purchase_lines (0007), salt_admins/is_salt_admin (0054).
-- Run after 0055.

create table if not exists public.master_price_stats (
  master_item_id uuid primary key references public.master_items (id) on delete cascade,
  n_orgs integer not null,        -- distinct contributing orgs (the privacy denominator)
  n_lines integer not null,       -- purchase lines behind the medians
  ptr_median_paise bigint,        -- median cost-to-retailer per unit ('' when no priced lines)
  mrp_median_paise bigint,        -- median printed MRP per unit
  last_seen date,                 -- most recent contributing purchase
  updated_at timestamptz not null default now()
);

alter table public.master_price_stats enable row level security;
drop policy if exists "master_price_stats read" on public.master_price_stats;
-- Aggregates are safe to read (min-N gated below); writes happen only via the definer fn.
create policy "master_price_stats read" on public.master_price_stats
  for select using (auth.role() = 'authenticated');

-- Recompute the crowd aggregates from cross-org purchase_lines. SECURITY DEFINER so it can read
-- every org's lines (bypassing per-org RLS) — but it only ever WRITES min-N aggregates, never raw
-- rows. Admin-gated; run from the SQL editor or schedule via pg_cron.
create or replace function public.refresh_master_price_stats()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_min_n constant integer := 3;  -- need >= 3 distinct orgs before publishing (anonymity gate)
  v_count integer;
begin
  if not public.is_salt_admin() then
    raise exception 'not authorized';
  end if;
  delete from public.master_price_stats;
  insert into public.master_price_stats
    (master_item_id, n_orgs, n_lines, ptr_median_paise, mrp_median_paise, last_seen, updated_at)
  select
    i.master_item_id,
    count(distinct pl.org_id),
    count(*),
    (percentile_cont(0.5) within group (order by pl.ptr_paise) filter (where pl.ptr_paise > 0))::bigint,
    (percentile_cont(0.5) within group (order by pl.mrp_paise) filter (where pl.mrp_paise > 0))::bigint,
    max(p.received_date),
    now()
  from public.purchase_lines pl
  join public.items i on i.id = pl.item_id and i.master_item_id is not null
  left join public.purchases p on p.id = pl.purchase_id
  group by i.master_item_id
  having count(distinct pl.org_id) >= v_min_n;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.refresh_master_price_stats() to authenticated;  -- gated by is_salt_admin inside
