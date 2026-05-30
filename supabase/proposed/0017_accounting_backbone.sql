-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0017: Accounting backbone — double-entry on a light chart of accounts.
-- Every document (sale, purchase, note, payment) posts balanced ledger_entries.
-- Party balance, trial balance, P&L, balance sheet, and GST liability all become
-- SUM() over ledger_entries. Party balances roll up to Sundry Debtors/Creditors
-- by ledgers.type in v_trial_balance (0023) — no control-account column needed.
-- Depends on: orgs (0002), ledgers (0007), shops (0014). Run after 0016.

-- 1. chart_accounts: the seeded chart -------------------------------------
create table public.chart_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'income', 'expense', 'equity')),
  parent_id uuid references public.chart_accounts (id) on delete set null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index chart_accounts_org_idx on public.chart_accounts (org_id);

alter table public.chart_accounts enable row level security;
create policy "chart_accounts read"   on public.chart_accounts for select using (public.is_member(org_id));
create policy "chart_accounts insert" on public.chart_accounts for insert with check (public.is_member(org_id));
create policy "chart_accounts update" on public.chart_accounts for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "chart_accounts delete" on public.chart_accounts for delete using (public.is_member(org_id));

-- 2. ledger_entries: the double-entry posting layer ----------------------
-- Exactly one of account_id / party_id is set; exactly one of debit/credit is nonzero.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  entry_date date not null default current_date,
  account_id uuid references public.chart_accounts (id) on delete restrict,
  party_id   uuid references public.ledgers (id) on delete restrict,
  debit_paise  bigint not null default 0,
  credit_paise bigint not null default 0,
  ref_table text,
  ref_id uuid,
  narration text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint ledger_entries_account_xor_party check ((account_id is not null) <> (party_id is not null)),
  constraint ledger_entries_dr_xor_cr check ((debit_paise = 0) <> (credit_paise = 0)),
  constraint ledger_entries_nonneg check (debit_paise >= 0 and credit_paise >= 0)
);
create index ledger_entries_account_idx on public.ledger_entries (org_id, account_id);
create index ledger_entries_party_idx   on public.ledger_entries (org_id, party_id);
create index ledger_entries_ref_idx     on public.ledger_entries (ref_table, ref_id);
create index ledger_entries_date_idx    on public.ledger_entries (org_id, entry_date);

alter table public.ledger_entries enable row level security;
create policy "ledger_entries read"   on public.ledger_entries for select using (public.is_member(org_id));
create policy "ledger_entries insert" on public.ledger_entries for insert with check (public.is_member(org_id));
create policy "ledger_entries update" on public.ledger_entries for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "ledger_entries delete" on public.ledger_entries for delete using (public.is_member(org_id));

-- 3. journal_vouchers: header for manual journal entries -----------------
create table public.journal_vouchers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  voucher_no text,
  voucher_date date not null default current_date,
  narration text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index journal_vouchers_org_idx on public.journal_vouchers (org_id);

alter table public.journal_vouchers enable row level security;
create policy "journal_vouchers read"   on public.journal_vouchers for select using (public.is_member(org_id));
create policy "journal_vouchers insert" on public.journal_vouchers for insert with check (public.is_member(org_id));
create policy "journal_vouchers update" on public.journal_vouchers for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "journal_vouchers delete" on public.journal_vouchers for delete using (public.is_member(org_id));

-- 4. seed_chart_of_accounts: the standard pharmacy COA -------------------
create or replace function public.seed_chart_of_accounts(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chart_accounts (org_id, code, name, type, is_system) values
    (p_org, 'CASH',       'Cash',                   'asset',     true),
    (p_org, 'BANK',       'Bank',                   'asset',     true),
    (p_org, 'DEBTORS',    'Sundry Debtors',         'asset',     true),
    (p_org, 'CREDITORS',  'Sundry Creditors',       'liability', true),
    (p_org, 'SALES',      'Sales',                  'income',    true),
    (p_org, 'SALES_RET',  'Sales Return',           'income',    true),
    (p_org, 'PURCHASE',   'Purchase',               'expense',   true),
    (p_org, 'PUR_RET',    'Purchase Return',        'expense',   true),
    (p_org, 'CGST_OUT',   'CGST Output',            'liability', true),
    (p_org, 'SGST_OUT',   'SGST Output',            'liability', true),
    (p_org, 'IGST_OUT',   'IGST Output',            'liability', true),
    (p_org, 'CGST_IN',    'CGST Input (ITC)',       'asset',     true),
    (p_org, 'SGST_IN',    'SGST Input (ITC)',       'asset',     true),
    (p_org, 'IGST_IN',    'IGST Input (ITC)',       'asset',     true),
    (p_org, 'DISC_ALLOW', 'Discount Allowed',       'expense',   true),
    (p_org, 'DISC_RECV',  'Discount Received',      'income',    true),
    (p_org, 'ROUNDOFF',   'Round Off',              'expense',   true),
    (p_org, 'OB_EQUITY',  'Opening Balance Equity', 'equity',    true)
  on conflict (org_id, code) do nothing;
end; $$;

-- Resolve a system account id by code — helper for the document RPCs (0018-0021).
create or replace function public.account_id(p_org uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.chart_accounts where org_id = p_org and code = p_code;
$$;

-- Post one side of a double entry; silently skips a fully-zero amount so callers
-- can pass e.g. igst=0 on an intra-state sale without tripping the dr/cr check.
create or replace function public.post_entry(
  p_org uuid, p_shop uuid, p_account uuid, p_party uuid,
  p_debit bigint, p_credit bigint, p_ref_table text, p_ref_id uuid, p_narration text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_debit, 0) = 0 and coalesce(p_credit, 0) = 0 then return; end if;
  insert into public.ledger_entries (
    org_id, shop_id, account_id, party_id, debit_paise, credit_paise, ref_table, ref_id, narration)
  values (
    p_org, p_shop, p_account, p_party, coalesce(p_debit, 0), coalesce(p_credit, 0), p_ref_table, p_ref_id, p_narration);
end; $$;

-- 5. New orgs seed a COA on creation. Preserves the 0003 guard + 0014 shop.
create or replace function public.create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  insert into public.orgs (name, created_by) values (p_name, auth.uid())
  returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');
  insert into public.shops (org_id, name, code, is_primary)
  values (new_org, p_name, 'MAIN', true);
  perform public.seed_chart_of_accounts(new_org);
  return new_org;
end; $$;

-- 6. Backfill: seed a COA for every existing org, then post opening balances
--    as balanced entries (party side + Opening Balance Equity contra).
do $$
declare r record; v_shop uuid; v_obe uuid;
begin
  for r in select id from public.orgs loop
    perform public.seed_chart_of_accounts(r.id);
  end loop;

  for r in
    select id as ledger_id, org_id, opening_balance_paise
    from public.ledgers where opening_balance_paise <> 0
      and not exists (  -- idempotent: skip if this party already has an opening entry
        select 1 from public.ledger_entries le
        where le.party_id = public.ledgers.id and le.ref_table = 'opening')
  loop
    select id into v_shop from public.shops where org_id = r.org_id and is_primary;
    select id into v_obe  from public.chart_accounts where org_id = r.org_id and code = 'OB_EQUITY';
    -- + balance = receivable (Dr party); - balance = payable (Cr party).
    insert into public.ledger_entries (org_id, shop_id, party_id, debit_paise, credit_paise, ref_table, narration)
    values (r.org_id, v_shop, r.ledger_id,
            greatest(r.opening_balance_paise, 0), greatest(-r.opening_balance_paise, 0),
            'opening', 'Opening balance');
    -- Contra to Opening Balance Equity keeps the books balanced.
    insert into public.ledger_entries (org_id, shop_id, account_id, debit_paise, credit_paise, ref_table, narration)
    values (r.org_id, v_shop, v_obe,
            greatest(-r.opening_balance_paise, 0), greatest(r.opening_balance_paise, 0),
            'opening', 'Opening balance contra');
  end loop;
end $$;
