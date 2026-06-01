-- 0032: Merge duplicate item-master rows (catalogue dedup, user-driven).
-- Folds two or more duplicate items (the same product entered twice — e.g.
-- "Dolo 650" + "DOLO-650") into one chosen survivor:
--   * re-points every child reference (stock batches, sale/purchase/order/PO
--     lines, stock movements, physical-count lines, debit-note lines, aliases)
--     onto the survivor, so deleting the duplicates never cascades away data,
--   * adopts the survivor's missing barcode / master-item link from a duplicate,
--   * drops any manual substitute rows touching a merged item (the same-salt
--     substitute engine is computed live, so nothing is lost functionally; this
--     also avoids self-referential / duplicate rows the re-point would create),
--   * deletes the merged-away items.
-- One statement => atomic. Security definer, so it checks org membership
-- explicitly (RLS is bypassed inside the function). Mirrors merge_ledgers (0009).
-- Run in the Supabase SQL editor after the catalogue slice (0015) is applied.

create or replace function public.merge_items(p_survivor uuid, p_merged uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_targets uuid[];
  v_count integer;
begin
  -- Survivor must exist and belong to one of the caller's orgs.
  select org_id into v_org from public.items where id = p_survivor;
  if v_org is null then
    raise exception 'survivor item not found';
  end if;
  if not public.is_member(v_org) then
    raise exception 'not authorized for this organization';
  end if;

  -- Reject any requested target outside the survivor's org.
  if exists (
    select 1 from unnest(p_merged) mid
    where mid <> p_survivor
      and not exists (select 1 from public.items where id = mid and org_id = v_org)
  ) then
    raise exception 'cannot merge items across organizations';
  end if;

  -- Targets = requested merges, minus the survivor, all in the same org.
  select array_agg(id) into v_targets
  from public.items
  where id = any(p_merged) and id <> p_survivor and org_id = v_org;

  if v_targets is null then
    return 0; -- nothing to merge
  end if;

  -- Re-point every child reference onto the survivor (item_id is globally unique,
  -- and the targets are validated to this org, so no org filter is needed).
  update public.batches              set item_id = p_survivor where item_id = any(v_targets);
  update public.sale_lines           set item_id = p_survivor where item_id = any(v_targets);
  update public.purchase_lines       set item_id = p_survivor where item_id = any(v_targets);
  update public.order_lines          set item_id = p_survivor where item_id = any(v_targets);
  update public.po_lines             set item_id = p_survivor where item_id = any(v_targets);
  update public.stock_movements      set item_id = p_survivor where item_id = any(v_targets);
  update public.physical_count_lines set item_id = p_survivor where item_id = any(v_targets);
  update public.debit_note_lines     set item_id = p_survivor where item_id = any(v_targets);
  update public.item_aliases         set item_id = p_survivor where item_id = any(v_targets);

  -- Drop manual substitute rows touching a merged item (see header note).
  delete from public.item_substitutes
    where item_id = any(v_targets) or substitute_item_id = any(v_targets);

  -- Adopt the survivor's missing barcode / master link from a merged item.
  update public.items s set
    barcode        = coalesce(s.barcode, t.barcode),
    master_item_id = coalesce(s.master_item_id, t.master_item_id)
  from (
    select
      (array_agg(barcode)        filter (where barcode        is not null))[1] as barcode,
      (array_agg(master_item_id) filter (where master_item_id is not null))[1] as master_item_id
    from public.items
    where id = any(v_targets)
  ) t
  where s.id = p_survivor;

  -- Remove the merged-away items.
  delete from public.items where id = any(v_targets);
  get diagnostics v_count = row_count;

  return v_count;
end $$;

grant execute on function public.merge_items(uuid, uuid[]) to authenticated;
