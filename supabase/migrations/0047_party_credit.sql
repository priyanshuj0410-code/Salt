-- 0047: server-side party-credit RPC (SALT-213) — the enabler for restricting
-- financial reads. The counter credit-limit check (lib/credit.ts fetchPartyCredit,
-- SALT-004) totals a party's dues by reading ledgers + sales_invoices + purchases
-- + payments directly, for EVERY member. Role-gating those reads would silently
-- undercount dues for cashiers. This RPC computes the dues server-side
-- (SECURITY DEFINER, bypasses RLS) with an is_member gate, so the credit check
-- works for any member WITHOUT direct table reads — then 0048 can tighten RLS.
--
-- Mirrors the client math exactly (lib/orders partyDue + paymentsAdjustment):
--   due = opening_balance
--       + Σ sales (total − paid)            -- a sale is a receivable (+)
--       − Σ purchases (total − paid)        -- a purchase is a payable (−)
--       + Σ payments (paid:+amount, received:−amount)
-- excluding imported docs (posts_effects = false), which are already folded into
-- opening_balance. Money integer paise. Additive + safe to run anytime. After 0046.

-- has_any_role: membership role in a set (forward-compat for manager/accountant)
create or replace function public.has_any_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role::text = any(p_roles)
  );
$$;
grant execute on function public.has_any_role(uuid, text[]) to authenticated;

-- party_credit: credit limit + current outstanding dues for a party
create or replace function public.party_credit(p_org uuid, p_party uuid)
returns table (credit_limit_paise bigint, due_paise bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_opening bigint; v_limit bigint; v_sales bigint; v_purch bigint; v_pay bigint;
begin
  if not public.is_member(p_org) then raise exception 'not a member of this organization'; end if;

  select coalesce(opening_balance_paise, 0), coalesce(credit_limit_paise, 0)
    into v_opening, v_limit
    from public.ledgers where id = p_party and org_id = p_org;
  if not found then return; end if;   -- no such party → no rows (caller treats as null)

  select coalesce(sum(total_paise - paid_paise), 0) into v_sales
    from public.sales_invoices
    where org_id = p_org and party_id = p_party and posts_effects is distinct from false;

  select coalesce(sum(total_paise - paid_paise), 0) into v_purch
    from public.purchases
    where org_id = p_org and vendor_id = p_party and posts_effects is distinct from false;

  select coalesce(sum(case when direction = 'paid' then amount_paise else -amount_paise end), 0) into v_pay
    from public.payments
    where org_id = p_org and party_id = p_party and posts_effects is distinct from false;

  credit_limit_paise := v_limit;
  due_paise := v_opening + v_sales - v_purch + v_pay;
  return next;
end; $$;
grant execute on function public.party_credit(uuid, uuid) to authenticated;
