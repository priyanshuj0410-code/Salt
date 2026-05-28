-- 0005: Migration upload tokens. Lets an external migrator push items/batches
-- into a specific org WITHOUT a user session. An owner generates a one-time,
-- org-scoped, expiring token; the migrator redeems it with just the token.
-- Run in the Supabase SQL editor after 0004.

create table public.migration_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  org_id uuid not null references public.orgs (id) on delete cascade,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_at timestamptz
);

alter table public.migration_tokens enable row level security;

-- Owners can view their org's tokens. Inserts happen only via the RPC below.
create policy "owners read tokens" on public.migration_tokens
  for select using (
    exists (
      select 1 from public.memberships m
      where m.org_id = migration_tokens.org_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

-- An owner generates a token for their org.
create or replace function public.create_migration_token()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_token text;
begin
  select org_id into v_org from public.memberships
   where user_id = auth.uid() and role = 'owner'
   limit 1;
  if v_org is null then
    raise exception 'Only an org owner can create a migration token';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.migration_tokens (token, org_id, created_by)
  values (v_token, v_org, auth.uid());
  return v_token;
end; $$;

-- Redeem a token: insert items + batches into the token's org, atomically.
-- Callable with only the token (the token is the bearer credential).
create or replace function public.redeem_migration_token(p_token text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_item jsonb;
  v_item_id uuid;
  v_batch jsonb;
  v_sched text;
  v_items int := 0;
  v_batches int := 0;
begin
  select org_id into v_org from public.migration_tokens
   where token = p_token and used_at is null and expires_at > now();
  if v_org is null then
    raise exception 'Invalid, expired, or already-used token';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sched := upper(coalesce(v_item->>'schedule', 'OTC'));
    if v_sched not in ('OTC', 'H', 'H1', 'X') then
      v_sched := 'OTC';
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
      v_sched,
      nullif(v_item->>'barcode', '')
    )
    returning id into v_item_id;
    v_items := v_items + 1;

    for v_batch in select * from jsonb_array_elements(coalesce(v_item->'batches', '[]'::jsonb)) loop
      insert into public.batches (org_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
      values (
        v_org, v_item_id,
        nullif(v_batch->>'batch_no', ''),
        nullif(v_batch->>'expiry', ''),
        coalesce((v_batch->>'qty')::int, 0),
        coalesce((v_batch->>'mrp_paise')::int, 0),
        coalesce((v_batch->>'ptr_paise')::int, 0)
      );
      v_batches := v_batches + 1;
    end loop;
  end loop;

  update public.migration_tokens set used_at = now() where token = p_token;
  return jsonb_build_object('items', v_items, 'batches', v_batches);
end; $$;

grant execute on function public.create_migration_token() to authenticated;
grant execute on function public.redeem_migration_token(text, jsonb) to anon, authenticated;
