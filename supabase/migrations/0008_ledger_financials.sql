-- 0008: Ledger financials + party classification.
-- - opening balance on ledgers (signed: + = receivable/Dr, - = payable/Cr)
-- - type becomes customer / vendor / other
-- - ledger_bills: per-invoice open items parsed from the trial balance
-- - known_vendors reference table + classify_parties RPC (server-side tagging)
-- Run after 0007.

-- 1. ledgers: reclassify type + opening balance ---------------------------
alter table public.ledgers drop constraint if exists ledgers_type_check;
update public.ledgers set type = 'vendor' where type = 'supplier';
update public.ledgers set type = 'customer' where type = 'both';
alter table public.ledgers add constraint ledgers_type_check check (type in ('customer', 'vendor', 'other'));
alter table public.ledgers alter column type set default 'customer';
alter table public.ledgers add column opening_balance_paise bigint not null default 0;

-- 2. ledger_bills: bill-wise open items -----------------------------------
create table public.ledger_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  ledger_id uuid not null references public.ledgers (id) on delete cascade,
  ref_no text,
  bill_date date,
  amount_paise bigint not null default 0,
  nature text check (nature in ('dr', 'cr')),
  due_date date,
  days_overdue integer,
  created_at timestamptz not null default now()
);

create index ledger_bills_org_idx on public.ledger_bills (org_id);
create index ledger_bills_ledger_idx on public.ledger_bills (ledger_id);

alter table public.ledger_bills enable row level security;
create policy "bills read"   on public.ledger_bills for select using (public.is_member(org_id));
create policy "bills insert" on public.ledger_bills for insert with check (public.is_member(org_id));
create policy "bills update" on public.ledger_bills for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "bills delete" on public.ledger_bills for delete using (public.is_member(org_id));

-- 3. known_vendors: global reference list for classification ---------------
create table public.known_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  norm text not null,
  source text default 'seed',
  created_at timestamptz not null default now()
);

alter table public.known_vendors enable row level security;
-- Reference data: any signed-in user may read; writes happen via a privileged
-- refresh job (service role), so there is no insert/update policy.
create policy "known vendors read" on public.known_vendors for select using (auth.role() = 'authenticated');

insert into public.known_vendors (name, norm)
select v, regexp_replace(lower(v), '[^a-z0-9 ]', '', 'g')
from unnest(array[
  'Abbott','Abbott Healthcare','Abbott India','Cipla','Cipla Health','Sun Pharma','Sun Pharmaceutical',
  'Mankind','Mankind Pharma','Lupin','Torrent','Torrent Pharma','Alkem','Alkem Laboratories','Zydus',
  'Cadila','Dr Reddy','Aristo','Aristo Pharmaceuticals','Intas','Macleods','Glenmark','USV','Micro Labs',
  'Alembic','Ipca','Hetero','Hetero Healthcare','Biocon','Wockhardt','Pfizer','GSK','GlaxoSmithKline',
  'Sanofi','Novartis','AstraZeneca','Bayer','Emcure','Eris','Ajanta','Ajanta Pharma','Indoco','Unichem',
  'FDC','Albert David','Franco Indian','Win-Medicare','Himalaya','Dabur','Aditya Medisales','Leeford',
  'Leeford Healthcare','Zuventus','La Renon','Systopic','Akumentis','Corona Remedies','Stallion Laboratories',
  'Walter Bushnell','Bal Pharma','Sava Healthcare','Tablets India','Centaur','Blue Cross','Stadmed',
  'Mankind','Sun Pharma Laboratories','Apex Laboratories','Mankind','Dynamic Surgicals'
]) v;

-- 4. classify_parties: keyword 'other' -> known vendor -> else customer -----
create or replace function public.classify_parties(p_names text[])
returns table (name text, type text)
language sql stable security definer set search_path = public as $$
  with input as (
    select n, regexp_replace(lower(n), '[^a-z0-9 ]', '', 'g') as nn from unnest(p_names) n
  )
  select i.n,
    case
      when i.nn ~ '(^| )(cash|bank|sbi|hdfc|icici|axis|kotak|pnb|sales|purchase|gst|cgst|sgst|igst|tax|taxes|duties|capital|drawings|discount|round ?off|rounding|opening stock|closing stock|stock in hand|profit|loss|suspense|tds|tcs|freight|rent|salary|salaries|wages|electricity|telephone|commission|interest|charges|courier|printing|stationery|conveyance|insurance|depreciation|expense|expenses)( |$)'
        then 'other'
      when exists (select 1 from public.known_vendors kv where length(kv.norm) >= 4 and position(kv.norm in i.nn) > 0)
        then 'vendor'
      else 'customer'
    end
  from input i;
$$;

grant execute on function public.classify_parties(text[]) to authenticated;
