-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0021: Payments & receipts.
-- record_payment posts the cash/bank <-> party double entry and optionally allocates
-- the amount across specific open bills. 'received' = money in from a customer
-- (Dr cash/bank, Cr party); 'paid' = money out to a vendor (Dr party, Cr cash/bank).
-- cash_drawer and bank_statement_lines are hooks for shift reconciliation / bank rec.
-- Depends on: accounting (0017), ledgers (0007), shops (0014). Run after 0020.

-- 1. payments + allocations ----------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid not null references public.ledgers (id) on delete restrict,
  direction text not null check (direction in ('received', 'paid')),
  payment_date date not null default current_date,
  mode text not null check (mode in ('cash', 'upi', 'card', 'cheque', 'bank', 'adjustment')),
  amount_paise bigint not null default 0,
  reference text,                                  -- UTR / cheque no / txn id
  bank_account_id uuid references public.chart_accounts (id) on delete set null,
  notes text,
  status text not null default 'cleared' check (status in ('pending', 'cleared', 'bounced')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index payments_org_idx on public.payments (org_id, payment_date desc);
create index payments_party_idx on public.payments (party_id);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  target_table text not null check (target_table in ('sales_invoice', 'purchase', 'ledger_bill')),
  target_id uuid not null,
  allocated_paise bigint not null default 0,
  created_at timestamptz not null default now()
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_target_idx on public.payment_allocations (target_table, target_id);

alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
create policy "payments read"   on public.payments for select using (public.is_member(org_id));
create policy "payments insert" on public.payments for insert with check (public.is_member(org_id));
create policy "payments update" on public.payments for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "payments delete" on public.payments for delete using (public.is_member(org_id));
create policy "payment_allocations read"   on public.payment_allocations for select using (public.is_member(org_id));
create policy "payment_allocations insert" on public.payment_allocations for insert with check (public.is_member(org_id));
create policy "payment_allocations update" on public.payment_allocations for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "payment_allocations delete" on public.payment_allocations for delete using (public.is_member(org_id));

-- 2. record_payment ------------------------------------------------------
-- p_allocations: optional [{target_table, target_id, allocated_paise}]
create or replace function public.record_payment(
  p_shop_id uuid, p_party_id uuid, p_direction text, p_mode text, p_amount_paise bigint,
  p_reference text default null, p_allocations jsonb default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_pay uuid; v_cash_code text; v_alloc jsonb;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.shops where id = p_shop_id and org_id = v_org) then
    raise exception 'shop not in organization'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = v_org) then
    raise exception 'party not in organization'; end if;
  if p_direction not in ('received', 'paid') then raise exception 'invalid direction %', p_direction; end if;
  if p_mode = 'cash' then v_cash_code := 'CASH';
  elsif p_mode in ('upi', 'card', 'cheque', 'bank') then v_cash_code := 'BANK';
  else raise exception 'mode % must be posted via a journal voucher, not record_payment', p_mode;
  end if;

  insert into public.payments (org_id, shop_id, party_id, direction, mode, amount_paise, reference, notes, created_by)
  values (v_org, p_shop_id, p_party_id, p_direction, p_mode, p_amount_paise, p_reference, p_notes, auth.uid())
  returning id into v_pay;

  if p_allocations is not null then
    insert into public.payment_allocations (org_id, payment_id, target_table, target_id, allocated_paise)
    select v_org, v_pay, a->>'target_table', (a->>'target_id')::uuid, coalesce((a->>'allocated_paise')::bigint, 0)
    from jsonb_array_elements(p_allocations) a;
  end if;

  -- double entry
  if p_direction = 'received' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_cash_code), null, p_amount_paise, 0, 'payment', v_pay, 'Receipt');
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, 0, p_amount_paise, 'payment', v_pay, 'Receipt from party');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, p_amount_paise, 0, 'payment', v_pay, 'Payment to party');
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_cash_code), null, 0, p_amount_paise, 'payment', v_pay, 'Payment');
  end if;

  return v_pay;
end; $$;

grant execute on function public.record_payment(uuid, uuid, text, text, bigint, text, jsonb, text) to authenticated;

-- 3. cash_drawer: per-shift cash reconciliation (hook) -------------------
create table public.cash_drawer (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  shift_date date not null default current_date,
  opened_by uuid references auth.users (id),
  opening_paise bigint not null default 0,
  closing_paise bigint,
  expected_paise bigint,                          -- derived from CASH movements during the shift
  variance_paise bigint,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index cash_drawer_shop_idx on public.cash_drawer (shop_id, shift_date);

-- 4. bank_statement_lines: imported lines for bank reconciliation (hook) --
create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  bank_account_id uuid references public.chart_accounts (id) on delete set null,
  txn_date date,
  amount_paise bigint not null default 0,          -- signed: +credit / -debit
  description text,
  reference text,
  matched_entry_id uuid references public.ledger_entries (id) on delete set null,
  created_at timestamptz not null default now()
);
create index bank_statement_lines_org_idx on public.bank_statement_lines (org_id, txn_date);

alter table public.cash_drawer          enable row level security;
alter table public.bank_statement_lines enable row level security;
create policy "cash_drawer read"   on public.cash_drawer for select using (public.is_member(org_id));
create policy "cash_drawer insert" on public.cash_drawer for insert with check (public.is_member(org_id));
create policy "cash_drawer update" on public.cash_drawer for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "cash_drawer delete" on public.cash_drawer for delete using (public.is_member(org_id));
create policy "bank_statement_lines read"   on public.bank_statement_lines for select using (public.is_member(org_id));
create policy "bank_statement_lines insert" on public.bank_statement_lines for insert with check (public.is_member(org_id));
create policy "bank_statement_lines update" on public.bank_statement_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "bank_statement_lines delete" on public.bank_statement_lines for delete using (public.is_member(org_id));
