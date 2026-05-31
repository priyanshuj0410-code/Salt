-- 0029_entity_messages.sql — SALT-105
-- Internal messages (staff notes / chat) attached to any entity — a bill, a
-- customer, an item — and delivered live across counters via Supabase Realtime,
-- on the same per-org Postgres-changes substrate as the activity feed (0028).
--
-- entity_type is a free-text discriminator ('sales_invoice' | 'purchase' |
-- 'customer' | 'item' | …); entity_id is the target row's uuid. A thread is
-- (entity_type, entity_id). Authorship is stamped server-side so it can't be
-- spoofed from the client.

create table if not exists public.entity_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  body        text not null,
  author_id   uuid,                         -- stamped to auth.uid() by trigger
  author_name text,                          -- denormalized display name
  created_at  timestamptz not null default now()
);

create index if not exists entity_messages_thread_idx
  on public.entity_messages (org_id, entity_type, entity_id, created_at);

alter table public.entity_messages enable row level security;

drop policy if exists entity_messages_select on public.entity_messages;
create policy entity_messages_select on public.entity_messages
  for select using (public.is_member(org_id));

drop policy if exists entity_messages_insert on public.entity_messages;
create policy entity_messages_insert on public.entity_messages
  for insert with check (public.is_member(org_id));

-- Stamp the author from the JWT (authoritative — clients can't spoof it) and
-- denormalize the display name so the realtime payload renders without a join.
create or replace function public.tg_stamp_message_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  NEW.author_id := coalesce(NEW.author_id, auth.uid());
  if NEW.author_name is null and NEW.author_id is not null then
    select coalesce(full_name, email) into NEW.author_name
    from public.profiles where id = NEW.author_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_stamp_message_author on public.entity_messages;
create trigger trg_stamp_message_author before insert on public.entity_messages
  for each row execute function public.tg_stamp_message_author();

do $$
begin
  alter publication supabase_realtime add table public.entity_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end$$;
