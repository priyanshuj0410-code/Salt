-- 0043: record_payment — attribute a receipt to a salesman (SALT-195).
-- payments.salesman_id exists (0039_salesman) and the /salesmen collections
-- report reads it, but record_payment had no way to set it. This re-issues
-- record_payment with a trailing optional p_salesman_id (so all existing 8-arg
-- named callers keep working) and writes it on the payment row. Double-entry,
-- allocations and validation are otherwise verbatim from 0021. Unblocks SALT-193.
--
-- The arg list grows, so drop the 8-arg signature first (CREATE OR REPLACE would
-- leave a stale overload and make the PostgREST RPC ambiguous). Run after 0042.

drop function if exists public.record_payment(uuid, uuid, text, text, bigint, text, jsonb, text);

create or replace function public.record_payment(
  p_shop_id uuid, p_party_id uuid, p_direction text, p_mode text, p_amount_paise bigint,
  p_reference text default null, p_allocations jsonb default null, p_notes text default null,
  p_salesman_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_pay uuid; v_cash_code text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.shops where id = p_shop_id and org_id = v_org) then
    raise exception 'shop not in organization'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = v_org) then
    raise exception 'party not in organization'; end if;
  if p_direction not in ('received', 'paid') then raise exception 'invalid direction %', p_direction; end if;
  if p_salesman_id is not null and not exists (
       select 1 from public.salesmen where id = p_salesman_id and org_id = v_org and is_active) then
    raise exception 'salesman not in organization or inactive';
  end if;
  if p_mode = 'cash' then v_cash_code := 'CASH';
  elsif p_mode in ('upi', 'card', 'cheque', 'bank') then v_cash_code := 'BANK';
  else raise exception 'mode % must be posted via a journal voucher, not record_payment', p_mode;
  end if;

  insert into public.payments (org_id, shop_id, party_id, direction, mode, amount_paise, reference, notes, salesman_id, created_by)
  values (v_org, p_shop_id, p_party_id, p_direction, p_mode, p_amount_paise, p_reference, p_notes, p_salesman_id, auth.uid())
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

grant execute on function public.record_payment(uuid, uuid, text, text, bigint, text, jsonb, text, uuid) to authenticated;
