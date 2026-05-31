-- 0029: GL opening-balance import (SALT-126).
-- Party (debtor/creditor) opening balances already post as ledger_entries with
-- ref_table='opening' (0017 backfill / LedgerStep). This adds the *non-party* side:
-- import opening balances for GL accounts (Cash, Bank, Stock, Capital, loans, fixed
-- assets…) as balanced double entries — the account side + an Opening Balance Equity
-- contra — in ONE transaction. Accounts are matched by code then name, or created.
-- Idempotent per account (skips any account that already has an opening entry).
-- Note: do NOT post Sundry Debtors/Creditors here — those roll up from party
-- balances in v_trial_balance. Owner-only, org-scoped. Run after 0028.

create or replace function public.import_gl_opening(p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_shop uuid;
  v_obe uuid;
  v_line jsonb;
  v_acct uuid;
  v_code text;
  v_name text;
  v_type text;
  v_debit bigint;
  v_credit bigint;
  v_posted int := 0;
  v_created int := 0;
  v_skipped int := 0;
begin
  select org_id, role::text into v_org, v_role
  from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'You do not belong to an organization'; end if;
  if v_role is distinct from 'owner' then raise exception 'Only an owner can import opening balances'; end if;

  select id into v_shop from public.shops where org_id = v_org and is_primary;
  if v_shop is null then
    select id into v_shop from public.shops where org_id = v_org order by created_at limit 1;
  end if;
  if v_shop is null then raise exception 'Set up a shop before importing opening balances'; end if;

  -- Ensure the chart of accounts (and OB_EQUITY) exists for older orgs.
  select id into v_obe from public.chart_accounts where org_id = v_org and code = 'OB_EQUITY';
  if v_obe is null then
    perform public.seed_chart_of_accounts(v_org);
    select id into v_obe from public.chart_accounts where org_id = v_org and code = 'OB_EQUITY';
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_code := nullif(upper(trim(v_line->>'code')), '');
    v_name := nullif(trim(v_line->>'name'), '');
    v_type := nullif(lower(trim(v_line->>'type')), '');
    v_debit := coalesce((v_line->>'debit_paise')::bigint, 0);
    v_credit := coalesce((v_line->>'credit_paise')::bigint, 0);

    if v_name is null and v_code is null then continue; end if;
    if v_debit = 0 and v_credit = 0 then continue; end if;
    if v_debit <> 0 and v_credit <> 0 then
      raise exception 'Account % has both a debit and a credit', coalesce(v_name, v_code);
    end if;

    v_acct := null;
    if v_code is not null then
      select id into v_acct from public.chart_accounts where org_id = v_org and code = v_code;
    end if;
    if v_acct is null and v_name is not null then
      select id into v_acct from public.chart_accounts where org_id = v_org and lower(name) = lower(v_name) limit 1;
    end if;

    if v_acct is null then
      if v_type is null or v_type not in ('asset', 'liability', 'income', 'expense', 'equity') then
        raise exception 'New account % needs a valid type (asset/liability/income/expense/equity)', coalesce(v_name, v_code);
      end if;
      insert into public.chart_accounts (org_id, code, name, type, is_system)
      values (v_org, coalesce(v_code, 'GL_' || substr(md5(v_name), 1, 8)), coalesce(v_name, v_code), v_type, false)
      returning id into v_acct;
      v_created := v_created + 1;
    end if;

    -- Idempotent: an account that already has an opening entry is left alone.
    if exists (
      select 1 from public.ledger_entries
      where org_id = v_org and account_id = v_acct and ref_table = 'opening'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Account side + Opening Balance Equity contra (each line balances itself;
    -- the dr/cr-xor and account/party-xor check constraints are satisfied).
    insert into public.ledger_entries (org_id, shop_id, account_id, debit_paise, credit_paise, ref_table, narration)
    values (v_org, v_shop, v_acct, v_debit, v_credit, 'opening', 'Opening balance');
    insert into public.ledger_entries (org_id, shop_id, account_id, debit_paise, credit_paise, ref_table, narration)
    values (v_org, v_shop, v_obe, v_credit, v_debit, 'opening', 'Opening balance contra');
    v_posted := v_posted + 1;
  end loop;

  return jsonb_build_object('posted', v_posted, 'created', v_created, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_gl_opening(jsonb) from public, anon;
grant execute on function public.import_gl_opening(jsonb) to authenticated;
