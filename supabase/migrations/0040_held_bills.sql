-- 0040: server-side held / parked bills (SALT-159).
-- Promotes the local in-memory parked bills (SALT-008, useBill.parked) to a
-- server store so a bill set aside on one counter can be resumed on another and
-- survives refresh / device swap. Table + three RPCs + realtime broadcast.
-- resume_bill is an ATOMIC claim (returns the snapshot AND deletes the row in one
-- statement) so two counters can never resume the same hold. No stock is
-- reserved — the save-time stock guard in create_sales_invoice stays
-- authoritative. Money integer paise; RLS is_member. Run after 0039.

-- 1. held_bills: a parked bill snapshot --------------------------------------
create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null,  -- null = walk-in
  lines jsonb not null default '[]'::jsonb,   -- the bill lines snapshot
  payment jsonb,                              -- { method, creditDays, tenders? }
  rx jsonb,                                   -- { doctorName, doctorRegNo, patientName, patientAddress }
  label text,                                 -- operator-given hold name
  held_by uuid references auth.users (id),
  held_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index held_bills_shop_idx on public.held_bills (org_id, shop_id, held_at desc);

alter table public.held_bills enable row level security;
create policy "held_bills read"   on public.held_bills for select using (public.is_member(org_id));
create policy "held_bills insert" on public.held_bills for insert with check (public.is_member(org_id));
create policy "held_bills update" on public.held_bills for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "held_bills delete" on public.held_bills for delete using (public.is_member(org_id));

-- 2. hold_bill: park a bill --------------------------------------------------
create or replace function public.hold_bill(
  p_shop_id uuid, p_party_id uuid, p_lines jsonb, p_payment jsonb default null,
  p_rx jsonb default null, p_label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.shops where id = p_shop_id and org_id = v_org) then
    raise exception 'shop not in organization';
  end if;
  insert into public.held_bills (org_id, shop_id, party_id, lines, payment, rx, label, held_by)
  values (v_org, p_shop_id, p_party_id, coalesce(p_lines, '[]'::jsonb), p_payment, p_rx, p_label, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.hold_bill(uuid, uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- 3. resume_bill: atomically claim (return snapshot + delete) ----------------
create or replace function public.resume_bill(p_id uuid)
returns public.held_bills
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.held_bills;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  delete from public.held_bills where id = p_id and org_id = v_org returning * into v_row;
  if not found then raise exception 'held bill not found or already resumed'; end if;
  return v_row;
end; $$;
grant execute on function public.resume_bill(uuid) to authenticated;

-- 4. discard_held_bill: drop a hold without resuming -------------------------
create or replace function public.discard_held_bill(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  delete from public.held_bills where id = p_id and org_id = v_org;
end; $$;
grant execute on function public.discard_held_bill(uuid) to authenticated;

-- 5. Broadcast holds to sibling counters. Wrapped so a re-run (already in the
-- publication) or a non-Supabase Postgres (no such publication) is a no-op.
do $$
begin
  alter publication supabase_realtime add table public.held_bills;
exception
  when duplicate_object then null;
  when undefined_object then null;
end$$;
