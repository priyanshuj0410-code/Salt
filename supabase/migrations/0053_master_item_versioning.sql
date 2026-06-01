-- 0053: master_items versioning + audit trail — SALT-084 (foundation).
-- As the central master evolves (GST/schedule/HSN corrections, new SKUs), we need a
-- version per row + an append-only audit so the push-to-shops flow (follow-up) can show
-- linked org items which master fields changed, as per-item *proposals* (never a silent
-- overwrite of a shop's edit). This migration is the schema half; the proposal/apply UI
-- + per-shop application log come next, reusing the "Fill from master" review pattern.
--
-- Model mirrors known_vendors/master_items: authenticated READ; master writes stay
-- privileged (SQL editor / admin), and the audit is written by a SECURITY DEFINER trigger
-- (so the read-only RLS on the audit table never blocks it). Idempotent — safe to re-run.
-- Depends on: master_items (0015). Run after 0052.

-- 1. Versioning columns on master_items.
alter table public.master_items
  add column if not exists version integer not null default 1,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid;

-- 2. Append-only audit: one row per (master_item, version) with a snapshot of its
--    identity/compliance fields. Authenticated read; only the trigger (definer) writes.
create table if not exists public.master_item_revisions (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.master_items (id) on delete cascade,
  version integer not null,
  name text,
  salt text,
  manufacturer text,
  pack text,
  hsn text,
  gst_rate numeric,
  gst_rate_class text,
  schedule text,
  source text,
  change_note text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create unique index if not exists master_item_revisions_ver
  on public.master_item_revisions (master_item_id, version);
create index if not exists master_item_revisions_item_idx
  on public.master_item_revisions (master_item_id, changed_at);

alter table public.master_item_revisions enable row level security;
drop policy if exists "master_item_revisions read" on public.master_item_revisions;
create policy "master_item_revisions read"
  on public.master_item_revisions for select using (auth.role() = 'authenticated');

-- 3a. BEFORE UPDATE: bump version + updated_at only when a material field actually changes
--     (so idempotent seed re-runs / no-op updates do not inflate the history).
create or replace function public.bump_master_item_version()
returns trigger language plpgsql as $$
begin
  if (new.name, new.salt, new.manufacturer, new.pack, new.hsn, new.gst_rate, new.gst_rate_class, new.schedule)
     is distinct from
     (old.name, old.salt, old.manufacturer, old.pack, old.hsn, old.gst_rate, old.gst_rate_class, old.schedule) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_master_item_bump on public.master_items;
create trigger trg_master_item_bump
  before update on public.master_items
  for each row execute function public.bump_master_item_version();

-- 3b. AFTER INSERT/UPDATE: append a revision snapshot whenever the version is (re)set.
--     SECURITY DEFINER so it can write the audit table under its read-only RLS.
create or replace function public.record_master_item_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and new.version = old.version) then
    return null; -- no material change → no new revision
  end if;
  insert into public.master_item_revisions
    (master_item_id, version, name, salt, manufacturer, pack, hsn, gst_rate, gst_rate_class, schedule, source, changed_by)
  values
    (new.id, new.version, new.name, new.salt, new.manufacturer, new.pack, new.hsn, new.gst_rate, new.gst_rate_class, new.schedule, new.source, new.updated_by);
  return null;
end $$;

drop trigger if exists trg_master_item_revision on public.master_items;
create trigger trg_master_item_revision
  after insert or update on public.master_items
  for each row execute function public.record_master_item_revision();

-- 4. Baseline: seed a v1 revision for every existing master row (rows that predate the
--    trigger), so the audit is complete from now on. Idempotent via the unique index.
insert into public.master_item_revisions
  (master_item_id, version, name, salt, manufacturer, pack, hsn, gst_rate, gst_rate_class, schedule, source)
select id, version, name, salt, manufacturer, pack, hsn, gst_rate, gst_rate_class, schedule, source
from public.master_items
on conflict (master_item_id, version) do nothing;
