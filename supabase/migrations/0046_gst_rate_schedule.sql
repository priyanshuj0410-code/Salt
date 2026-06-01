-- 0046: Date-effective GST rate schedule (companion to the master seed, SALT-081).
--
-- Medicine GST was overhauled at the 56th GST Council, effective 22 Sep 2025:
-- most finished medicaments (HSN 3004) moved 12% -> 5%, and a set of lifesaving
-- drugs to nil (Notification 9/2025-CT(Rate)). A tax invoice must use the rate in
-- force on its document date, so rates are stored as date ranges and resolved with
-- gst_rate_for(class, on_date). Sale/purchase lines already snapshot their own
-- gst_rate (0011/0020), so historical documents are unaffected -- this drives the
-- rate for NEW or back-dated documents and for catalogue display.
--
-- RLS: authenticated read only (reference data; mirrors known_vendors in 0008).
-- NOTE: verify the exact rates + cutover against the live CBIC notifications before
-- relying on this for filings. The rows below are the editable source of truth.
-- Run in the Supabase SQL editor.

create table if not exists public.gst_rate_schedule (
  id uuid primary key default gen_random_uuid(),
  rate_class text not null,          -- std | ayush | nil | gst18 (see master_items.gst_rate_class)
  rate numeric not null,             -- GST percentage, e.g. 12, 5, 0, 18
  effective_from date not null,
  effective_to date,                 -- null = currently in force
  source text,                       -- notification reference
  created_at timestamptz not null default now(),
  unique (rate_class, effective_from)
);
create index if not exists gst_rate_schedule_class_idx on public.gst_rate_schedule (rate_class, effective_from);

alter table public.gst_rate_schedule enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_rate_schedule' and policyname = 'gst_rate_schedule read') then
    create policy "gst_rate_schedule read" on public.gst_rate_schedule for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- Both eras, per rate class.
insert into public.gst_rate_schedule (rate_class, rate, effective_from, effective_to, source) values
  ('std',   12, '2017-07-01', '2025-09-21', 'GST 2017 schedule - finished medicaments (HSN 3004)'),
  ('std',    5, '2025-09-22', null,         '56th GST Council / 2025 notification - medicaments (HSN 3004)'),
  ('ayush', 12, '2017-07-01', '2025-09-21', 'GST 2017 schedule - AYUSH medicaments (HSN 3003/3004)'),
  ('ayush',  5, '2025-09-22', null,         '56th GST Council / 2025 notification - AYUSH  [VERIFY]'),
  ('nil',    0, '2025-09-22', null,         'Notification 9/2025-CT(Rate) - lifesaving drugs'),
  ('gst18', 18, '2017-07-01', null,         'HSN 3004 exceptions (e.g. nicotine gum, certain disinfectants)')
on conflict (rate_class, effective_from) do nothing;

-- Resolve the GST rate for a rate class on a given date (latest range that contains it).
create or replace function public.gst_rate_for(p_class text, p_on date)
returns numeric
language sql
stable
set search_path = public
as $$
  select rate
  from public.gst_rate_schedule
  where rate_class = p_class
    and effective_from <= p_on
    and (effective_to is null or effective_to >= p_on)
  order by effective_from desc
  limit 1;
$$;

grant execute on function public.gst_rate_for(text, date) to authenticated;
