-- 0054: Custom-item → promote-to-master review workflow — SALT-085 (foundation).
-- A shop can nominate one of its custom items (items.master_item_id is null) for the shared
-- master_items. To avoid polluting the global master, a nomination enters a REVIEW QUEUE and a
-- Salt-admin approves/rejects; only approved items are inserted into master_items. master_items
-- stays "all approved" (no read-filtering needed). Promotion + review run via SECURITY DEFINER
-- RPCs because normal users have no insert policy on master_items.
-- Approver model (per product decision): a Salt-admin moderation queue.
-- Depends on: orgs (0002), items (0004), is_member/memberships, master_items (0015). Run after 0053.

-- 1. Minimal Salt-admin registry (global moderators of the shared master).
--    Seed an admin manually:  insert into public.salt_admins (user_id) values ('<auth-uid>');
create table if not exists public.salt_admins (
  user_id uuid primary key,
  added_at timestamptz not null default now()
);
alter table public.salt_admins enable row level security;
drop policy if exists "salt_admins self-read" on public.salt_admins;
create policy "salt_admins self-read" on public.salt_admins for select using (user_id = auth.uid());

create or replace function public.is_salt_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salt_admins where user_id = auth.uid());
$$;
grant execute on function public.is_salt_admin() to authenticated;

-- 2. Review queue. A pending submission snapshots the shop item's identity; on approval it is
--    copied into master_items (source='shop-submitted') and the origin item is linked.
create table if not exists public.master_item_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  salt text,
  manufacturer text,
  pack text,
  hsn text,
  gst_rate numeric not null default 0,
  schedule text not null default 'OTC',
  norm text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  master_item_id uuid references public.master_items (id) on delete set null,
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create index if not exists master_item_submissions_status_idx on public.master_item_submissions (status, submitted_at);
create index if not exists master_item_submissions_org_idx on public.master_item_submissions (org_id);

alter table public.master_item_submissions enable row level security;
-- A shop sees its own submissions; Salt-admins see all (to moderate). Writes go via the RPCs.
drop policy if exists "submissions read" on public.master_item_submissions;
create policy "submissions read" on public.master_item_submissions
  for select using (public.is_member(org_id) or public.is_salt_admin());

-- 3. promote_to_master: a shop nominates a custom item. If an existing master already matches
--    its norm, link straight to it (no submission); otherwise queue a pending submission.
create or replace function public.promote_to_master(p_item_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  it public.items;
  v_norm text;
  v_master uuid;
begin
  select * into it from public.items where id = p_item_id;
  if not found then raise exception 'item not found'; end if;
  if not public.is_member(it.org_id) then raise exception 'not a member of this org'; end if;
  if it.master_item_id is not null then return 'already_linked'; end if;

  v_norm := trim(regexp_replace(lower(coalesce(it.name, '')), '[^a-z0-9 ]', '', 'g'));
  if v_norm = '' then raise exception 'item has no usable name'; end if;

  -- dedupe: an existing master with the same norm → just link to it.
  select id into v_master from public.master_items where norm = v_norm limit 1;
  if v_master is not null then
    update public.items set master_item_id = v_master where id = p_item_id;
    return 'linked';
  end if;

  -- already a pending submission for this item? avoid duplicates.
  if exists (select 1 from public.master_item_submissions where item_id = p_item_id and status = 'pending') then
    return 'pending';
  end if;

  insert into public.master_item_submissions
    (org_id, item_id, name, salt, manufacturer, pack, hsn, gst_rate, schedule, norm, submitted_by)
  values
    (it.org_id, it.id, it.name, it.salt, it.manufacturer, it.pack, it.hsn, it.gst_rate,
     case when it.schedule in ('OTC', 'H', 'H1', 'X') then it.schedule else 'OTC' end, v_norm, auth.uid());
  return 'submitted';
end $$;
grant execute on function public.promote_to_master(uuid) to authenticated;

-- 4. review_master_submission: a Salt-admin approves (→ insert into master_items + link the
--    origin item) or rejects a pending submission.
create or replace function public.review_master_submission(p_submission_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  s public.master_item_submissions;
  v_master uuid;
begin
  if not public.is_salt_admin() then raise exception 'not authorized'; end if;
  select * into s from public.master_item_submissions where id = p_submission_id;
  if not found then raise exception 'submission not found'; end if;
  if s.status <> 'pending' then raise exception 'submission already %', s.status; end if;

  if not p_approve then
    update public.master_item_submissions
      set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_submission_id;
    return 'rejected';
  end if;

  -- approve: dedupe once more, then insert into the master (or reuse an existing norm match).
  select id into v_master from public.master_items where norm = s.norm limit 1;
  if v_master is null then
    insert into public.master_items (name, salt, manufacturer, pack, hsn, gst_rate, schedule, norm, source)
    values (s.name, s.salt, s.manufacturer, s.pack, s.hsn, s.gst_rate, s.schedule, s.norm, 'shop-submitted')
    returning id into v_master;
  end if;

  update public.master_item_submissions
    set status = 'approved', master_item_id = v_master, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_submission_id;
  update public.items set master_item_id = v_master where id = s.item_id and master_item_id is null;
  return 'approved';
end $$;
grant execute on function public.review_master_submission(uuid, boolean) to authenticated;
