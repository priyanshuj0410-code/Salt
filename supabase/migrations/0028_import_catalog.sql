-- 0028: Atomic catalogue import (SALT-127).
-- The client importer inserts items, then inserts batches in chunks — so a failure
-- partway leaves a half-imported catalogue with no clean undo. This wraps the whole
-- import in ONE transaction (a plpgsql function is atomic): any error rolls the entire
-- import back, and the caller learns nothing was saved. Owner-only, org-scoped.
-- Run in the Supabase SQL editor after 0027.

create or replace function public.import_catalog(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_item jsonb;
  v_batch jsonb;
  v_item_id uuid;
  v_items int := 0;
  v_batches int := 0;
begin
  -- Resolve the caller's org + role (one org per user, see 0003).
  select org_id, role::text into v_org, v_role
  from public.memberships
  where user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'You do not belong to an organization';
  end if;
  if v_role is distinct from 'owner' then
    raise exception 'Only an owner can import the catalogue';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(trim(v_item->>'name'), '') = '' then
      raise exception 'Every item needs a name';
    end if;

    insert into public.items (org_id, name, salt, manufacturer, pack, hsn, gst_rate, schedule, barcode)
    values (
      v_org,
      v_item->>'name',
      nullif(v_item->>'salt', ''),
      nullif(v_item->>'manufacturer', ''),
      nullif(v_item->>'pack', ''),
      nullif(v_item->>'hsn', ''),
      coalesce((v_item->>'gst_rate')::numeric, 0),
      coalesce(nullif(v_item->>'schedule', ''), 'OTC'),
      nullif(v_item->>'barcode', '')
    )
    returning id into v_item_id;
    v_items := v_items + 1;

    for v_batch in select value from jsonb_array_elements(coalesce(v_item->'batches', '[]'::jsonb)) loop
      insert into public.batches (org_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
      values (
        v_org,
        v_item_id,
        nullif(v_batch->>'batch_no', ''),
        nullif(v_batch->>'expiry', ''),
        coalesce((v_batch->>'qty')::int, 0),
        coalesce((v_batch->>'mrp_paise')::int, 0),
        coalesce((v_batch->>'ptr_paise')::int, 0)
      );
      v_batches := v_batches + 1;
    end loop;
  end loop;

  return jsonb_build_object('items', v_items, 'batches', v_batches);
end;
$$;

revoke all on function public.import_catalog(jsonb) from public, anon;
grant execute on function public.import_catalog(jsonb) to authenticated;
