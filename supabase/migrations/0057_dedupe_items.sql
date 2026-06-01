-- 0057: dedupe_items — one-shot bulk merge of double-imported duplicate item rows.
-- A re-import left the catalogue at ~2x: ~7,850 names appear exactly twice (same org_id + name +
-- manufacturer + pack). The shipped per-group UI merge (SALT-086 / merge_items) does not scale to
-- thousands of pairs, so this finds exact duplicate groups and merges each via merge_items — which
-- reassigns batches + sale/purchase/order/po/movement/count/debit-note lines + aliases to the
-- survivor, then deletes the rest. Survivor = most stock, then most batches, then oldest.
--
-- SAFE: DRY RUN by default — returns the counts that WOULD merge; pass p_dry_run := false to apply.
-- RE-RUNNABLE: merging is idempotent (a second run finds only what remains), so if a full run times
-- out just call it again until rows_to_merge = 0.
-- Depends on: items (0004), merge_items (0032, SECURITY DEFINER). Run after 0056.
--
-- Run it (SQL editor — find your org via `select id from public.orgs;`):
--   select * from public.dedupe_items('<org-uuid>', true);   -- preview: dup_groups / rows_to_merge
--   select * from public.dedupe_items('<org-uuid>', false);  -- apply

create or replace function public.dedupe_items(p_org uuid, p_dry_run boolean default true)
returns table(dup_groups integer, rows_to_merge integer)
language plpgsql security definer set search_path = public as $$
declare
  g record;
  v_survivor uuid;
  v_merged uuid[];
  v_groups integer := 0;
  v_rows integer := 0;
begin
  -- Client calls must be a member of the org; allow owner / cron (no auth.uid()) for SQL-editor runs.
  if auth.uid() is not null and not public.is_member(p_org) then
    raise exception 'not a member of this org';
  end if;

  for g in
    select lower(btrim(name)) as nname, coalesce(manufacturer, '') as mfr, coalesce(pack, '') as pk
    from public.items
    where org_id = p_org
    group by 1, 2, 3
    having count(*) > 1
  loop
    -- Pick the survivor: most stock, then most batches, then oldest, then stable id.
    select i.id into v_survivor
    from public.items i
    where i.org_id = p_org
      and lower(btrim(i.name)) = g.nname
      and coalesce(i.manufacturer, '') = g.mfr
      and coalesce(i.pack, '') = g.pk
    order by
      (select coalesce(sum(b.qty), 0) from public.batches b where b.item_id = i.id) desc,
      (select count(*) from public.batches b where b.item_id = i.id) desc,
      i.created_at asc,
      i.id asc
    limit 1;

    select array_agg(i.id) into v_merged
    from public.items i
    where i.org_id = p_org
      and lower(btrim(i.name)) = g.nname
      and coalesce(i.manufacturer, '') = g.mfr
      and coalesce(i.pack, '') = g.pk
      and i.id <> v_survivor;

    v_groups := v_groups + 1;
    v_rows := v_rows + coalesce(array_length(v_merged, 1), 0);
    if not p_dry_run and coalesce(array_length(v_merged, 1), 0) > 0 then
      perform public.merge_items(v_survivor, v_merged);
    end if;
  end loop;

  return query select v_groups, v_rows;
end $$;

grant execute on function public.dedupe_items(uuid, boolean) to authenticated;
