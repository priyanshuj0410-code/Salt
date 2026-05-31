-- 0028: Inventory write RPCs — adjustments, physical-count reconciliation, and
-- expiry destruction. Each posts a signed row to stock_movements (0016) and keeps
-- the cached batches.qty in step, atomically and server-side (security definer),
-- mirroring receive_purchase (0019). The movement row IS the audit trail
-- (reason + note + created_by + created_at). No GL entry for stock corrections:
-- purchases are expensed at receipt (periodic inventory), so adjustments don't
-- post to the ledger; the one exception is the ITC reversal on destruction below.
-- Run in the Supabase SQL editor after the proposed 0014-0017 slices are live.

-- 1. adjust_stock: one-off correction / write-off of a single batch ----------
-- p_reason ∈ {'adjustment','writeoff'} (the stock_movements check constraint).
-- p_qty_delta is signed: negative for breakage/theft/write-off, positive to
-- correct an undercount. On-hand may not go below zero.
create or replace function public.adjust_stock(
  p_batch_id uuid,
  p_qty_delta integer,
  p_reason text,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_shop uuid; v_item uuid; v_qty integer; v_ptr integer; v_move uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  if p_reason not in ('adjustment', 'writeoff') then
    raise exception 'invalid reason % (expected adjustment or writeoff)', p_reason;
  end if;
  if coalesce(p_qty_delta, 0) = 0 then raise exception 'qty_delta must be non-zero'; end if;

  -- Lock the batch and confirm it belongs to the caller's org.
  select shop_id, item_id, qty, ptr_paise into v_shop, v_item, v_qty, v_ptr
  from public.batches where id = p_batch_id and org_id = v_org for update;
  if not found then raise exception 'batch not in organization'; end if;
  if v_shop is null then
    select id into v_shop from public.shops where org_id = v_org and is_primary limit 1;
  end if;
  if v_qty + p_qty_delta < 0 then
    raise exception 'adjustment of % would drive on-hand below zero (have %)', p_qty_delta, v_qty;
  end if;

  update public.batches set qty = qty + p_qty_delta where id = p_batch_id;

  insert into public.stock_movements (
    org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, note, created_by
  ) values (
    v_org, v_shop, v_item, p_batch_id, p_qty_delta, p_reason, coalesce(v_ptr, 0), 'adjustment', p_note, auth.uid()
  ) returning id into v_move;

  return v_move;
end; $$;

grant execute on function public.adjust_stock(uuid, integer, text, text) to authenticated;

-- 2. finalize_physical_count: reconcile a stock-take ------------------------
-- For every draft count line with a non-zero variance (counted − system), set
-- the batch on-hand to the counted figure and post an 'adjustment' movement of
-- the variance (referencing the count). Marks the count finalized. Returns the
-- number of lines adjusted. The lines themselves are inserted/edited client-side
-- (RLS-gated) while the count is a draft; only the posting is centralised here.
create or replace function public.finalize_physical_count(p_count_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_shop uuid; v_n integer := 0; r record;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  select shop_id into v_shop from public.physical_counts
    where id = p_count_id and org_id = v_org and status = 'draft' for update;
  if not found then raise exception 'count not found or already finalized'; end if;
  if v_shop is null then
    select id into v_shop from public.shops where org_id = v_org and is_primary limit 1;
  end if;

  for r in
    select l.item_id, l.batch_id, l.counted_qty, l.variance, coalesce(b.ptr_paise, 0) as ptr
    from public.physical_count_lines l
    left join public.batches b on b.id = l.batch_id
    where l.count_id = p_count_id and l.org_id = v_org
  loop
    if r.batch_id is not null and r.variance <> 0 then
      update public.batches set qty = r.counted_qty where id = r.batch_id and org_id = v_org;
      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, note, created_by
      ) values (
        v_org, v_shop, r.item_id, r.batch_id, r.variance, 'adjustment', r.ptr, 'physical_count', p_count_id, 'Physical count variance', auth.uid()
      );
      v_n := v_n + 1;
    end if;
  end loop;

  update public.physical_counts set status = 'finalized' where id = p_count_id;
  return v_n;
end; $$;

grant execute on function public.finalize_physical_count(uuid) to authenticated;
