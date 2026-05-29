-- 0011: Extend place_order to handle purchases (goods in from a vendor).
-- A purchase ADDS stock: each line upserts a batch (increments qty if the
-- (org, item, batch_no) batch exists, else inserts it) and refreshes its
-- ptr/mrp/expiry from the line. Payable increases by the order total.
-- The sale branch is unchanged. p_lines may carry an extra `mrp_paise` key
-- (used only for purchases, to price the received batch). Run after 0010.

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
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then
    raise exception 'no organization for current user';
  end if;

  if p_direction not in ('sale', 'purchase') then
    raise exception 'invalid direction %', p_direction;
  end if;

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

  -- Purchases add stock: upsert the received batch.
  elsif p_direction = 'purchase' then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      v_item := nullif(v_line->>'item_id', '')::uuid;
      v_batch := v_line->>'batch_no';
      v_qty := coalesce((v_line->>'qty')::integer, 0);
      if v_item is not null and v_qty > 0 then
        update public.batches set
          qty = qty + v_qty,
          ptr_paise = coalesce(nullif((v_line->>'rate_paise')::integer, 0), ptr_paise),
          mrp_paise = coalesce(nullif((v_line->>'mrp_paise')::integer, 0), mrp_paise),
          expiry = coalesce(nullif(v_line->>'expiry', ''), expiry)
          where org_id = v_org and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch, '');
        if not found then
          insert into public.batches (org_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
          values (
            v_org, v_item, v_batch, nullif(v_line->>'expiry', ''),
            v_qty,
            coalesce((v_line->>'mrp_paise')::integer, 0),
            coalesce((v_line->>'rate_paise')::integer, 0)
          );
        end if;
      end if;
    end loop;
  end if;

  return v_order;
end; $$;
