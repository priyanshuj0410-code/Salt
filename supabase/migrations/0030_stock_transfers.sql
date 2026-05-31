-- 0030: Inter-shop stock transfers RPC (SALT-042).
-- Moves stock between two shops in the same org. Posts a transfer_out movement
-- (decrement the source-shop batch) and a transfer_in movement (increment, or
-- create, the matching destination-shop batch), records the stock_transfers
-- header + lines, all atomically and server-side (security definer) — mirrors
-- receive_purchase (0019) / adjust_stock (0028). The stock_transfers /
-- stock_transfer_lines tables (0016) are already live. Multi-shop management
-- ships in SALT-090. Run in the Supabase SQL editor.

create or replace function public.receive_transfer(
  p_from_shop uuid,
  p_to_shop uuid,
  p_lines jsonb,
  p_transfer_no text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_xfer uuid; v_line jsonb;
  v_item uuid; v_batch uuid; v_qty integer; v_src_qty integer;
  v_batch_no text; v_expiry text; v_expiry_date date; v_mrp integer; v_ptr integer;
  v_dest uuid; v_n integer := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if p_from_shop = p_to_shop then raise exception 'source and destination shops must differ'; end if;

  perform 1 from public.shops where id = p_from_shop and org_id = v_org;
  if not found then raise exception 'source shop not in organization'; end if;
  perform 1 from public.shops where id = p_to_shop and org_id = v_org;
  if not found then raise exception 'destination shop not in organization'; end if;

  insert into public.stock_transfers (org_id, from_shop_id, to_shop_id, transfer_no, status, notes, created_by)
  values (v_org, p_from_shop, p_to_shop, p_transfer_no, 'received', p_notes, auth.uid())
  returning id into v_xfer;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_batch := nullif(v_line->>'batch_id', '')::uuid;
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    if v_batch is null or v_qty <= 0 then continue; end if;

    -- Lock the source batch; confirm org + source shop + sufficient on-hand.
    select item_id, qty, batch_no, expiry, expiry_date, mrp_paise, ptr_paise
      into v_item, v_src_qty, v_batch_no, v_expiry, v_expiry_date, v_mrp, v_ptr
      from public.batches
      where id = v_batch and org_id = v_org and shop_id = p_from_shop
      for update;
    if not found then raise exception 'batch % not in source shop', v_batch; end if;
    if v_src_qty < v_qty then
      raise exception 'insufficient stock for batch % (have %, need %)', v_batch, v_src_qty, v_qty;
    end if;

    update public.batches set qty = qty - v_qty where id = v_batch;

    -- Find the matching destination-shop batch (same item + batch_no), else create it.
    select id into v_dest from public.batches
      where org_id = v_org and shop_id = p_to_shop and item_id = v_item
        and coalesce(batch_no, '') = coalesce(v_batch_no, '')
      limit 1;
    if v_dest is null then
      insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, expiry_date, qty, mrp_paise, ptr_paise)
      values (v_org, p_to_shop, v_item, v_batch_no, v_expiry, v_expiry_date, v_qty, coalesce(v_mrp, 0), coalesce(v_ptr, 0))
      returning id into v_dest;
    else
      update public.batches set qty = qty + v_qty where id = v_dest;
    end if;

    insert into public.stock_transfer_lines (org_id, transfer_id, item_id, batch_id, qty)
    values (v_org, v_xfer, v_item, v_batch, v_qty);

    insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by)
    values (v_org, p_from_shop, v_item, v_batch, -v_qty, 'transfer_out', coalesce(v_ptr, 0), 'stock_transfer', v_xfer, auth.uid());
    insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by)
    values (v_org, p_to_shop, v_item, v_dest, v_qty, 'transfer_in', coalesce(v_ptr, 0), 'stock_transfer', v_xfer, auth.uid());

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'transfer has no valid lines'; end if;
  return v_xfer;
end; $$;

grant execute on function public.receive_transfer(uuid, uuid, jsonb, text, text) to authenticated;
