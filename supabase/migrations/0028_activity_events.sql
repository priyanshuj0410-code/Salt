-- 0028_activity_events.sql — SALT-104
-- Shop-wide activity feed: an append-only log of significant actions (sales,
-- payments, GRNs) captured SERVER-SIDE by triggers, so every counter's actions
-- surface live on every other counter. First slice of the real-time / multi-
-- counter substrate (PRD Phase 5). Streamed to the client via Supabase Realtime.
--
-- Design:
--  * The trigger reads to_jsonb(NEW) and pulls fields with NULL-safe ->> over a
--    list of candidate column names. So this migration cannot fail on a column a
--    given table happens not to have — a missing key just yields NULL. The only
--    hard dependency is id + org_id, guaranteed on every business table by the
--    tenancy convention.
--  * Rows are denormalized (party_name, actor_name) so the realtime INSERT
--    payload is self-contained — the client renders straight from it, no join.
--  * Imported / non-posting rows (posts_effects = false) are skipped, so a bulk
--    historical import never floods the feed.
--  * Logging is best-effort: any error is swallowed so it can never break the
--    underlying sale / payment / GRN write.

create table if not exists public.activity_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  kind         text not null,                  -- sale | purchase | payment_in | payment_out
  entity_type  text,                           -- source table (deep-link hint)
  entity_id    uuid,                            -- source row id
  actor_id     uuid,                            -- auth user who acted (the "counter")
  actor_name   text,                            -- denormalized display name
  party_id     uuid,                            -- ledgers id, when relevant
  party_name   text,                            -- denormalized party name
  title        text not null,                  -- short human label
  amount_paise bigint,                          -- monetary magnitude, when relevant
  ref          text,                            -- invoice_no / grn_no / reference
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists activity_events_org_created_idx
  on public.activity_events (org_id, created_at desc);

alter table public.activity_events enable row level security;

-- Any org member can read the shop's feed (cashiers included — multi-counter
-- awareness is the point). Inserts are normally done by the SECURITY DEFINER
-- trigger below; the insert policy also lets members emit their own org's events
-- directly (future client-side activity), with org_id pinned to a member org.
drop policy if exists activity_events_select on public.activity_events;
create policy activity_events_select on public.activity_events
  for select using (public.is_member(org_id));

drop policy if exists activity_events_insert on public.activity_events;
create policy activity_events_insert on public.activity_events
  for insert with check (public.is_member(org_id));

-- One generic logger, parameterized via TG_ARGV[0]=kind, TG_ARGV[1]=entity_type.
create or replace function public.tg_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb := to_jsonb(NEW);
  v_kind     text  := tg_argv[0];
  v_etype    text  := tg_argv[1];
  v_org      uuid;
  v_party    uuid;
  v_actor    uuid;
  v_amount   bigint;
  v_ref      text;
  v_party_nm text;
  v_actor_nm text;
  v_title    text;
begin
  -- Skip non-posting / imported rows so bulk imports never flood the feed.
  if (r->>'posts_effects') = 'false' then
    return NEW;
  end if;

  v_org   := nullif(r->>'org_id', '')::uuid;
  if v_org is null then
    return NEW;
  end if;
  v_party := nullif(r->>'party_id', '')::uuid;
  v_actor := coalesce(nullif(r->>'created_by', '')::uuid, auth.uid());

  v_amount := coalesce(nullif(r->>'total_paise', '')::bigint,
                       nullif(r->>'amount_paise', '')::bigint,
                       nullif(r->>'grand_total_paise', '')::bigint);

  v_ref := coalesce(r->>'invoice_no', r->>'grn_no', r->>'vendor_invoice_no',
                    r->>'reference', r->>'order_no');

  if v_party is not null then
    select name into v_party_nm from public.ledgers where id = v_party;
  end if;
  if v_actor is not null then
    select coalesce(full_name, email) into v_actor_nm from public.profiles where id = v_actor;
  end if;

  -- Payment direction ('received' | 'paid') refines the kind + label.
  if v_kind = 'payment' then
    v_kind := case when (r->>'direction') = 'paid' then 'payment_out' else 'payment_in' end;
  end if;

  v_title := case v_kind
    when 'sale'        then 'Sale'
    when 'purchase'    then 'Purchase (GRN)'
    when 'payment_in'  then 'Payment received'
    when 'payment_out' then 'Payment made'
    else initcap(v_kind)
  end;

  insert into public.activity_events
    (org_id, kind, entity_type, entity_id, actor_id, actor_name,
     party_id, party_name, title, amount_paise, ref)
  values
    (v_org, v_kind, v_etype, nullif(r->>'id', '')::uuid, v_actor, v_actor_nm,
     v_party, v_party_nm, v_title, v_amount, v_ref);

  return NEW;
exception when others then
  -- Activity logging is a side channel; never let it break the business write.
  return NEW;
end;
$$;

drop trigger if exists trg_activity_sale on public.sales_invoices;
create trigger trg_activity_sale after insert on public.sales_invoices
  for each row execute function public.tg_log_activity('sale', 'sales_invoice');

drop trigger if exists trg_activity_payment on public.payments;
create trigger trg_activity_payment after insert on public.payments
  for each row execute function public.tg_log_activity('payment', 'payment');

drop trigger if exists trg_activity_purchase on public.purchases;
create trigger trg_activity_purchase after insert on public.purchases
  for each row execute function public.tg_log_activity('purchase', 'purchase');

-- Stream INSERTs to subscribed clients. Wrapped so a re-run (table already in
-- the publication) or a non-Supabase Postgres (no such publication) is a no-op.
do $$
begin
  alter publication supabase_realtime add table public.activity_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end$$;
