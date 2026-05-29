-- 0009: Merge duplicate party ledgers (user-driven, suggest-and-confirm).
-- Combines two or more ledgers of the same real party — e.g. a debtor +
-- creditor split of one vendor, or an accidental re-import — into one:
--   * re-points their open bills to the survivor,
--   * folds the SIGNED opening balances together (so the trial balance net
--     is preserved exactly),
--   * adopts identity fields (gstin/phone/address) only where the survivor
--     is missing them,
--   * deletes the merged-away ledgers.
-- Runs as one statement => atomic. Security definer, so it explicitly checks
-- org membership (RLS is bypassed inside the function). Run after 0008.

create or replace function public.merge_ledgers(p_survivor uuid, p_merged uuid[])
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
  select org_id into v_org from public.ledgers where id = p_survivor;
  if v_org is null then
    raise exception 'survivor ledger not found';
  end if;
  if not public.is_member(v_org) then
    raise exception 'not authorized for this organization';
  end if;

  -- Reject any requested target that is outside the survivor's org.
  if exists (
    select 1 from unnest(p_merged) mid
    where mid <> p_survivor
      and not exists (select 1 from public.ledgers where id = mid and org_id = v_org)
  ) then
    raise exception 'cannot merge ledgers across organizations';
  end if;

  -- Targets = requested merges, minus the survivor, all in the same org.
  select array_agg(id) into v_targets
  from public.ledgers
  where id = any(p_merged) and id <> p_survivor and org_id = v_org;

  if v_targets is null then
    return 0; -- nothing to merge
  end if;

  -- Re-point open bills onto the survivor.
  update public.ledger_bills
    set ledger_id = p_survivor
    where ledger_id = any(v_targets) and org_id = v_org;

  -- Fold signed balances into the survivor; adopt missing identity fields.
  update public.ledgers s set
    opening_balance_paise = s.opening_balance_paise + coalesce(t.bal, 0),
    gstin   = coalesce(s.gstin,   t.gstin),
    phone   = coalesce(s.phone,   t.phone),
    address = coalesce(s.address, t.address)
  from (
    select
      sum(opening_balance_paise) as bal,
      (array_agg(gstin)   filter (where gstin   is not null))[1] as gstin,
      (array_agg(phone)   filter (where phone   is not null))[1] as phone,
      (array_agg(address) filter (where address is not null))[1] as address
    from public.ledgers
    where id = any(v_targets)
  ) t
  where s.id = p_survivor;

  -- Remove the merged ledgers.
  delete from public.ledgers where id = any(v_targets);
  get diagnostics v_count = row_count;

  return v_count;
end $$;

grant execute on function public.merge_ledgers(uuid, uuid[]) to authenticated;
