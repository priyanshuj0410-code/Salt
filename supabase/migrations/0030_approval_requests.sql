-- 0030_approval_requests.sql — SALT-106
-- Approve-from-manager-device: a cashier raises an approval request on one
-- device; the owner/manager sees it live on another and approves/rejects; the
-- decision flows back live. Same per-org Postgres-changes substrate (0028/0029),
-- now also carrying UPDATEs (status changes), not just INSERTs.
--
-- Security: anyone in the org may RAISE a request (stamped + pinned to pending
-- by a trigger, so it can't be self-approved). There is NO client UPDATE policy
-- — decisions go only through the SECURITY DEFINER RPCs below, which enforce
-- "only an owner decides" and "only the requester cancels".

create table if not exists public.approval_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  kind              text not null default 'other',     -- discount_override | credit_override | price_override | return_auth | void_bill | other
  summary           text not null,
  amount_paise      bigint,
  context           jsonb not null default '{}'::jsonb,  -- entity refs (bill id, party id, …)
  status            text not null default 'pending',   -- pending | approved | rejected | cancelled
  requested_by      uuid,
  requested_by_name text,
  decided_by        uuid,
  decided_by_name   text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists approval_requests_org_status_idx
  on public.approval_requests (org_id, status, created_at desc);

alter table public.approval_requests enable row level security;

-- All members see the org's requests (the requester tracks status; managers act).
drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests
  for select using (public.is_member(org_id));

-- Any member may RAISE a request; the trigger pins it to pending + stamps them.
drop policy if exists approval_requests_insert on public.approval_requests;
create policy approval_requests_insert on public.approval_requests
  for insert with check (public.is_member(org_id));

-- (No UPDATE policy on purpose — status is only ever written by the RPCs below.)

create or replace function public.tg_stamp_approval_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.requested_by := coalesce(NEW.requested_by, auth.uid());
  if NEW.requested_by_name is null and NEW.requested_by is not null then
    select coalesce(full_name, email) into NEW.requested_by_name
    from public.profiles where id = NEW.requested_by;
  end if;
  -- A raised request is always pending; can't self-approve via insert.
  NEW.status := 'pending';
  NEW.decided_by := null;
  NEW.decided_by_name := null;
  NEW.decided_at := null;
  return NEW;
end;
$$;

drop trigger if exists trg_stamp_approval_request on public.approval_requests;
create trigger trg_stamp_approval_request before insert on public.approval_requests
  for each row execute function public.tg_stamp_approval_request();

-- Owner-only decision. Returns the updated row.
create or replace function public.decide_approval_request(p_id uuid, p_approved boolean)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests;
  v_uid uuid := auth.uid();
begin
  select * into v_req from public.approval_requests where id = p_id;
  if not found then
    raise exception 'approval request not found';
  end if;
  if not exists (
    select 1 from public.memberships
    where org_id = v_req.org_id and user_id = v_uid and role = 'owner'
  ) then
    raise exception 'only an owner can decide approvals';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already %', v_req.status;
  end if;

  update public.approval_requests
     set status          = case when p_approved then 'approved' else 'rejected' end,
         decided_by      = v_uid,
         decided_by_name = (select coalesce(full_name, email) from public.profiles where id = v_uid),
         decided_at      = now()
   where id = p_id
   returning * into v_req;
  return v_req;
end;
$$;

-- Requester may cancel their own still-pending request.
create or replace function public.cancel_approval_request(p_id uuid)
returns public.approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.approval_requests;
  v_uid uuid := auth.uid();
begin
  select * into v_req from public.approval_requests where id = p_id;
  if not found then
    raise exception 'approval request not found';
  end if;
  if v_req.requested_by <> v_uid then
    raise exception 'only the requester can cancel';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already %', v_req.status;
  end if;
  update public.approval_requests
     set status = 'cancelled', decided_at = now()
   where id = p_id
   returning * into v_req;
  return v_req;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.approval_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end$$;
