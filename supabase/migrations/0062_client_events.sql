-- Client-emitted telemetry (SALT-36). activity_events (0028) and audit_log are
-- server-written and SUCCESS-ONLY, so they are structurally blind to bills that
-- never reached Postgres — queued offline, parked (poison), or failed/timed-out
-- on a flaky link. This table captures those client-side outcomes so we can
-- answer "are internet outages losing bills?" from data instead of anecdote.
--
-- Written by fire-and-forget inserts from the app (lib/clientEvents.ts); never on
-- the critical billing path. No PII: amounts and counts only, never party/contact.
create table if not exists public.client_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  shop_id      uuid,
  actor_id     uuid,                                 -- auth.uid() of the acting user
  name         text not null,                        -- event name (see SALT-36)
  bill_ref     uuid,                                 -- outbox record id; threads queued -> synced/parked
  amount_paise bigint,                               -- money at risk (paise)
  occurred_at  timestamptz not null default now(),   -- client clock (may have been offline at the time)
  received_at  timestamptz not null default now(),   -- server clock on insert
  meta         jsonb       not null default '{}'::jsonb  -- {kind, attempts, reason, ...}; no PII
);

alter table public.client_events enable row level security;

-- Any authenticated member of the org may record events for that org and read them.
-- (drop-then-create so a re-run in the SQL editor is a no-op, matching 0028.)
drop policy if exists client_events_insert on public.client_events;
create policy client_events_insert on public.client_events
  for insert to authenticated with check (public.is_member(org_id));
drop policy if exists client_events_select on public.client_events;
create policy client_events_select on public.client_events
  for select to authenticated using (public.is_member(org_id));

create index if not exists client_events_org_name_time on public.client_events (org_id, name, occurred_at);

-- Decision query (run after ~10-14 days): bills LOST/abandoned to connectivity.
--
-- READ WITH CARE — absolute counts are biased; read trends + the parked count:
--  * `offline_bill_parked` is the RELIABLE primary loss signal: one event, emitted
--    online at flush, a bill that went poison after maxAttempts.
--  * "queued minus synced" is only a SOFT UPPER BOUND. It over-counts (the queued
--    and synced inserts are independent best-effort writes over the same flaky link,
--    so a dropped `synced` insert reads as a phantom loss) AND under-counts (a bill
--    on a device that never reconnects emits nothing — but it is genuinely lost too;
--    the founder interview, not this table, covers that catastrophic case).
--
--   select date_trunc('day', occurred_at) d,
--          count(*) filter (where name = 'offline_bill_parked')                       as parked_lost,
--          count(*) filter (where name = 'bill_queued_offline')                       as queued,
--          count(*) filter (where name = 'offline_bill_synced')                       as synced_ok,
--          count(*) filter (where name in ('bill_save_failed','bill_save_timeout'))   as online_failures,
--          sum(amount_paise) filter (where name = 'offline_bill_parked')              as parked_value_paise
--   from public.client_events
--   group by 1 order by 1;
