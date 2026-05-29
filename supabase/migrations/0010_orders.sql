-- 0010: Orders (sales + purchases) + lines, and the place_order RPC.
-- A sale is a "bill"; party_id null = walk-in. All money in paise.
-- Sales move stock (decrement batches). Run after 0009.

-- 1. orders --------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null, -- null = walk-in
  direction text not null check (direction in ('sale', 'purchase')),
  order_no text,
  order_date date not null default current_date,
  status text not null default 'placed',
  payment_method text,
  credit_days integer,
  due_date date,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index orders_org_created_idx on public.orders (org_id, created_at desc);
create index orders_party_idx on public.orders (party_id);

-- 2. order_lines ---------------------------------------------------------
create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  rate_paise bigint not null default 0, -- MRP for sale, PTR for purchase
  discount_type text,
  discount_value numeric not null default 0,
  gst_rate numeric not null default 0,
  line_total_paise bigint not null default 0,
  created_at timestamptz not null default now()
);

create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_org_idx on public.order_lines (org_id);

-- 3. RLS: deny-by-default, per-org via is_member --------------------------
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy "orders read"   on public.orders for select using (public.is_member(org_id));
create policy "orders insert" on public.orders for insert with check (public.is_member(org_id));
create policy "orders update" on public.orders for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "orders delete" on public.orders for delete using (public.is_member(org_id));

create policy "order_lines read"   on public.order_lines for select using (public.is_member(org_id));
create policy "order_lines insert" on public.order_lines for insert with check (public.is_member(org_id));
create policy "order_lines update" on public.order_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "order_lines delete" on public.order_lines for delete using (public.is_member(org_id));

-- 4. place_order: insert order + lines, move stock, set due — atomically --
-- p_lines is a JSON array of:
--   {item_id, name, batch_no, expiry, qty, rate_paise,
--    discount_type, discount_value, gst_rate, line_total_paise}
create or replace function public.place_order(
  p_direction text,
  p_party_id uuid,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_order_no text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_order uuid;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_due date := null;
  v_line jsonb;
  v_item uuid;
  v_batch text;
  v_qty integer;
begin
  -- Resolve the caller's org (one org per user, per migration 0003).
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then
    raise exception 'no organization for current user';
  end if;

  if p_direction not in ('sale', 'purchase') then
    raise exception 'invalid direction %', p_direction;
  end if;

  -- A named party must belong to the caller's org.
  if p_party_id is not null and not exists (
    select 1 from public.ledgers where id = p_party_id and org_id = v_org
  ) then
    raise exception 'party not in organization';
  end if;

  select coalesce(sum((l->>'line_total_paise')::bigint), 0) into v_total
  from jsonb_array_elements(p_lines) l;

  if p_payment_method = 'cash' then
    v_paid := v_total;
  else
    v_paid := 0;
    if coalesce(p_credit_days, 0) > 0 then
      v_due := current_date + p_credit_days;
    end if;
  end if;

  insert into public.orders (
    org_id, party_id, direction, order_no, status,
    payment_method, credit_days, due_date, total_paise, paid_paise, notes
  ) values (
    v_org, p_party_id, p_direction, p_order_no, 'placed',
    p_payment_method, p_credit_days, v_due, v_total, v_paid, p_notes
  ) returning id into v_order;

  insert into public.order_lines (
    org_id, order_id, item_id, name, batch_no, expiry, qty,
    rate_paise, discount_type, discount_value, gst_rate, line_total_paise
  )
  select v_org, v_order,
    nullif(l->>'item_id', '')::uuid,
    coalesce(l->>'name', ''),
    l->>'batch_no',
    l->>'expiry',
    coalesce((l->>'qty')::integer, 0),
    coalesce((l->>'rate_paise')::bigint, 0),
    l->>'discount_type',
    coalesce((l->>'discount_value')::numeric, 0),
    coalesce((l->>'gst_rate')::numeric, 0),
    coalesce((l->>'line_total_paise')::bigint, 0)
  from jsonb_array_elements(p_lines) l;

  -- Sales decrement stock from the matching batch (guarded against oversell).
  if p_direction = 'sale' then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_item := nullif(v_line->>'item_id', '')::uuid;
      v_batch := v_line->>'batch_no';
      v_qty := coalesce((v_line->>'qty')::integer, 0);
      if v_item is not null and v_qty > 0 then
        update public.batches
          set qty = qty - v_qty
          where org_id = v_org and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch, '')
            and qty >= v_qty;
        if not found then
          raise exception 'insufficient stock for item % batch %', v_item, coalesce(v_batch, '');
        end if;
      end if;
    end loop;
  end if;

  return v_order;
end; $$;

grant execute on function public.place_order(text, uuid, text, integer, jsonb, text, text) to authenticated;
