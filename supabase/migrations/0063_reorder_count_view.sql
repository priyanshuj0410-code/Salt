-- 0063: v_reorder_count — per-org count of items at or below their reorder
-- level, for the assembled Home's reorder (D) tile. On-hand = Σ batches.qty
-- (the cached current-on-hand from 0004/0016). Mirrors the client `reorderList`
-- rule exactly: reorder_level > 0 AND on-hand <= reorder_level (no is_active
-- filter, matching the Reorder page). security_invoker so the caller's is_member
-- RLS on items/batches applies — no new read surface, members-only like the
-- underlying tables.
create or replace view public.v_reorder_count with (security_invoker = true) as
with on_hand as (
  select item_id, sum(qty) as qty
  from public.batches
  group by item_id
)
select
  i.org_id,
  count(*)::int as reorder_count
from public.items i
left join on_hand oh on oh.item_id = i.id
where coalesce(i.reorder_level, 0) > 0
  and coalesce(oh.qty, 0) <= i.reorder_level
group by i.org_id;

grant select on public.v_reorder_count to authenticated;
