-- 0062: Two-lane OCR job queue — local Gemma worker + Flash fallback.
-- Implements M0 of prd-gemma-ocr-worker.md. Run in the Supabase SQL editor after 0061.
--
-- RECONCILIATION (committed != applied — probed the live schema first):
--   * The PRD's target table is "ocr_jobs"; the live, ACTIVELY-USED table is
--     public.invoice_scans (0049 + 0060 + 0061) — it is what extract-invoice /
--     process-scans write and what scan-history -> draft GRN -> receive_purchase
--     reads. We EXTEND it (per the PRD: "prefer ALTER over a new table if columns
--     overlap; downstream path untouched"), NOT the vestigial purchase_ocr_jobs
--     (0024, unread by any code) and NOT a brand-new table.
--   * Term mapping so the existing review UI keeps working unchanged:
--       PRD status 'done'        -> existing 'extracted'
--       PRD column 'source_doc_no' -> existing 'invoice_no' (0061, the dedup key)
--       PRD 'queued_at' is added new (a mutable TAT/backoff clock distinct from the
--       immutable audit column created_at).
--   * Idempotency is enforced in ocr_complete LOGIC (mark 'duplicate'), not a hard
--     unique index: 0061 deliberately chose a NON-unique (org_id, invoice_no) index
--     for cross-channel dedup-by-lookup, and the live table may already hold legit
--     multi-row repeats (retries, re-uploads) a unique constraint would reject.

begin;

-- 1. Extend invoice_scans into a leasable two-lane queue -----------------------
alter table public.invoice_scans
  add column if not exists lane             text        not null default 'queue',
  add column if not exists priority         int         not null default 0,
  add column if not exists worker_id        text,
  add column if not exists model            text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempts         int         not null default 0,
  add column if not exists max_attempts     int         not null default 3,
  add column if not exists queued_at        timestamptz not null default now(),
  add column if not exists leased_at        timestamptz,
  add column if not exists completed_at     timestamptz,
  add column if not exists escalated_at     timestamptz;

-- Existing rows: seed the TAT clock from their real creation time (the volatile
-- now() default above stamped them all with the migration's run-time otherwise).
update public.invoice_scans set queued_at = created_at where queued_at >= created_at;

-- lane: free local-Gemma queue vs paid/fallback Gemini Flash.
alter table public.invoice_scans drop constraint if exists invoice_scans_lane_check;
alter table public.invoice_scans
  add constraint invoice_scans_lane_check check (lane in ('queue', 'flash'));

-- status: extend the live enum (pending/processing/extracted/failed/posted/
-- duplicate from 0060) with the queue's lease + supersede states.
alter table public.invoice_scans drop constraint if exists invoice_scans_status_check;
alter table public.invoice_scans
  add constraint invoice_scans_status_check
  check (status in ('pending', 'leased', 'processing', 'extracted', 'failed', 'posted', 'duplicate', 'superseded'));

-- Lease scans hit only pending rows: index the ordering keys, partial on pending.
create index if not exists invoice_scans_lease_idx
  on public.invoice_scans (lane, priority desc, queued_at)
  where status = 'pending';

-- Salt admins read every org's scans for the operator console (members already
-- read their own via the 0049 policy; multiple permissive SELECT policies OR).
drop policy if exists "invoice_scans admin read" on public.invoice_scans;
create policy "invoice_scans admin read"
  on public.invoice_scans for select using (public.is_salt_admin());

-- 2. Worker registry (monitoring; online/offline derived from last_seen_at) ----
create table if not exists public.ocr_workers (
  worker_id    text primary key,
  hostname     text,
  model        text,
  status       text not null default 'online' check (status in ('online', 'draining', 'offline')),
  jobs_done    int  not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table public.ocr_workers enable row level security;
-- Only Salt admins read the registry; workers write via service role / the
-- SECURITY DEFINER RPCs below (no member insert/update path).
drop policy if exists "ocr_workers admin read" on public.ocr_workers;
create policy "ocr_workers admin read"
  on public.ocr_workers for select using (public.is_salt_admin());

-- 3. The only write path: SECURITY DEFINER RPCs ------------------------------
-- All run as the owner (bypassing RLS); the worker calls them with the service
-- role (v1 per PRD §7). lease/renew/complete/fail/reclaim/escalate are worker +
-- cron ops (granted to service_role only); request_instant is member-gated.

-- Atomically lease the oldest eligible pending job in the given lanes.
create or replace function public.ocr_lease_next(
  p_worker_id text,
  p_model text,
  p_lease_seconds int default 300,
  p_lanes text[] default array['queue']
) returns public.invoice_scans
language plpgsql security definer set search_path = public as $$
declare
  v_job public.invoice_scans;
begin
  -- Heartbeat / register the worker (status left as-is on conflict so an operator
  -- 'draining' instruction survives a poll).
  insert into public.ocr_workers (worker_id, model, last_seen_at)
  values (p_worker_id, p_model, now())
  on conflict (worker_id) do update
    set last_seen_at = now(), model = excluded.model;

  select * into v_job
  from public.invoice_scans
  where status = 'pending'
    and lane = any (p_lanes)
    and attempts < max_attempts
    and queued_at <= now()                 -- honour ocr_fail's backoff nudge
  order by priority desc, queued_at asc
  for update skip locked                    -- concurrent workers never collide
  limit 1;

  if not found then
    return null;
  end if;

  update public.invoice_scans
    set status = 'processing',
        worker_id = p_worker_id,
        model = p_model,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempts = attempts + 1,
        updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

-- Extend the lease for a long-running extraction (only the holding worker).
create or replace function public.ocr_renew_lease(
  p_job_id uuid, p_worker_id text, p_lease_seconds int default 300
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.invoice_scans
    set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = p_job_id and worker_id = p_worker_id and status in ('processing', 'leased');
end;
$$;

-- Store the extraction; map 'done' -> 'extracted'; dedup -> 'duplicate'.
create or replace function public.ocr_complete(
  p_job_id uuid, p_model text, p_json jsonb, p_source_doc_no text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_worker text;
  v_invoice text;
  v_dup boolean := false;
begin
  select org_id, worker_id into v_org, v_worker
  from public.invoice_scans where id = p_job_id;
  if v_org is null then
    raise exception 'ocr_complete: job % not found', p_job_id;
  end if;

  v_invoice := nullif(trim(coalesce(p_source_doc_no, p_json ->> 'invoice_no')), '');

  -- Idempotency: another extracted/posted scan of this invoice, or an already-
  -- posted GRN, makes this a duplicate (single terminal result per invoice).
  if v_invoice is not null then
    select
      exists (
        select 1 from public.invoice_scans
        where org_id = v_org and id <> p_job_id and invoice_no = v_invoice
          and status in ('extracted', 'posted')
      ) or exists (
        select 1 from public.purchases
        where org_id = v_org and vendor_invoice_no ilike v_invoice
      )
    into v_dup;
  end if;

  update public.invoice_scans
    set status        = case when v_dup then 'duplicate' else 'extracted' end,
        extracted_json = p_json,
        invoice_no    = coalesce(v_invoice, invoice_no),
        vendor_guess  = coalesce(nullif(trim(p_json ->> 'vendor'), ''), vendor_guess),
        model         = coalesce(p_model, model),
        error         = case when v_dup then 'already imported' else null end,
        completed_at  = now(),
        lease_expires_at = null,
        updated_at    = now()
  where id = p_job_id;

  if v_worker is not null then
    update public.ocr_workers set jobs_done = jobs_done + 1 where worker_id = v_worker;
  end if;
end;
$$;

-- Fail with retry: under max_attempts -> back to pending with a backoff nudge on
-- queued_at; otherwise terminal 'failed'.
create or replace function public.ocr_fail(
  p_job_id uuid, p_error text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_attempts int;
  v_max int;
begin
  select attempts, max_attempts into v_attempts, v_max
  from public.invoice_scans where id = p_job_id;
  if not found then
    raise exception 'ocr_fail: job % not found', p_job_id;
  end if;

  if v_attempts < v_max then
    update public.invoice_scans
      set status = 'pending', worker_id = null, leased_at = null, lease_expires_at = null,
          error = p_error,
          queued_at = now() + make_interval(secs => 60 * greatest(v_attempts, 1)),
          updated_at = now()
    where id = p_job_id;
  else
    update public.invoice_scans
      set status = 'failed', worker_id = null, lease_expires_at = null,
          error = p_error, updated_at = now()
    where id = p_job_id;
  end if;
end;
$$;

-- Cron tick: reclaim leases whose holder went dark (laptop crash) back to pending,
-- or fail them if attempts are exhausted. Returns the reclaimed count.
create or replace function public.ocr_reclaim_expired()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.invoice_scans
    set status = 'pending', worker_id = null, leased_at = null, lease_expires_at = null,
        error = 'lease expired; reclaimed', updated_at = now()
  where status in ('processing', 'leased')
    and lease_expires_at is not null and lease_expires_at < now()
    and attempts < max_attempts;
  get diagnostics v_n = row_count;

  update public.invoice_scans
    set status = 'failed', worker_id = null, lease_expires_at = null,
        error = 'lease expired; max attempts', updated_at = now()
  where status in ('processing', 'leased')
    and lease_expires_at is not null and lease_expires_at < now()
    and attempts >= max_attempts;

  return v_n;
end;
$$;

-- Paid "Fetch now": member-gated. Flip the queue job onto the flash lane and
-- re-queue it hot so the Flash driver picks it up. Same physical row => one
-- terminal result (this IS the supersede). No-op if already terminal.
create or replace function public.ocr_request_instant(p_job_id uuid)
returns public.invoice_scans
language plpgsql security definer set search_path = public as $$
declare v_job public.invoice_scans;
begin
  select * into v_job from public.invoice_scans where id = p_job_id;
  if not found then
    raise exception 'ocr_request_instant: job % not found', p_job_id;
  end if;
  if not public.is_member(v_job.org_id) then
    raise exception 'ocr_request_instant: not a member of this org';
  end if;
  if v_job.status in ('extracted', 'posted', 'duplicate') then
    return v_job;  -- already has a result; nothing to escalate
  end if;

  update public.invoice_scans
    set lane = 'flash', status = 'pending', priority = greatest(priority, 100),
        worker_id = null, leased_at = null, lease_expires_at = null,
        queued_at = now(), escalated_at = now(), updated_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- Cron tick (TAT guarantee): queue jobs older than the threshold escalate to the
-- flash lane so Flash drains them even with every laptop offline. Returns count.
create or replace function public.ocr_escalate_stale(p_threshold interval default interval '5 hours')
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.invoice_scans
    set lane = 'flash', priority = greatest(priority, 50), escalated_at = now(), updated_at = now()
  where lane = 'queue' and status = 'pending' and escalated_at is null
    and queued_at < now() - p_threshold;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 4. Grants -------------------------------------------------------------------
-- Worker + cron RPCs: service role only (they bypass tenant checks by design).
revoke all on function public.ocr_lease_next(text, text, int, text[])  from public;
revoke all on function public.ocr_renew_lease(uuid, text, int)          from public;
revoke all on function public.ocr_complete(uuid, text, jsonb, text)     from public;
revoke all on function public.ocr_fail(uuid, text)                      from public;
revoke all on function public.ocr_reclaim_expired()                     from public;
revoke all on function public.ocr_escalate_stale(interval)              from public;
grant execute on function public.ocr_lease_next(text, text, int, text[]) to service_role;
grant execute on function public.ocr_renew_lease(uuid, text, int)        to service_role;
grant execute on function public.ocr_complete(uuid, text, jsonb, text)   to service_role;
grant execute on function public.ocr_fail(uuid, text)                    to service_role;
grant execute on function public.ocr_reclaim_expired()                   to service_role;
grant execute on function public.ocr_escalate_stale(interval)            to service_role;

-- Member-gated "Fetch now" is callable by the signed-in shop user.
revoke all on function public.ocr_request_instant(uuid) from public;
grant execute on function public.ocr_request_instant(uuid) to authenticated;

commit;
