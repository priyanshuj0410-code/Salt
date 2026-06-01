-- 0042: gateway (Razorpay) payment capture — DB half of SALT-169.
-- The Razorpay webhook authenticates by HMAC, not a Supabase JWT, so it cannot
-- use record_payment (which resolves the org from auth.uid()). This adds a
-- thin, SERVICE-ROLE-ONLY RPC that takes org_id explicitly and is idempotent on
-- the gateway payment id, so a re-delivered webhook never double-posts.
--
-- SECURITY: granted to service_role ONLY (revoked from public/authenticated) —
-- otherwise a logged-in user could forge a paid receipt against any org. The
-- edge function calls it with the service-role key. Money integer paise.
-- Run after 0041.

-- 1. Idempotency columns on payments -----------------------------------------
alter table public.payments
  add column if not exists gateway     text,   -- 'razorpay' (null for manual payments)
  add column if not exists gateway_ref text;   -- the gateway payment/link id
-- One receipt per (org, gateway, gateway_ref). Manual payments leave both null
-- and never collide (NULLs are distinct in a unique index).
create unique index if not exists payments_gateway_ref_idx
  on public.payments (org_id, gateway, gateway_ref);

-- 2. record_gateway_payment: idempotent inbound collection -------------------
-- Posts a 'received' payment (Dr bank = Cr party) for a gateway collection.
-- Returns the payment id (existing one on idempotent re-delivery, with no second
-- posting). Resolves the shop when not given (org's primary, else earliest).
create or replace function public.record_gateway_payment(
  p_org_id uuid,
  p_party_id uuid,
  p_amount_paise bigint,
  p_gateway text,
  p_gateway_ref text,
  p_shop_id uuid default null,
  p_reference text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_pay uuid;
begin
  if p_org_id is null or p_party_id is null or coalesce(p_gateway_ref, '') = '' then
    raise exception 'org, party and gateway_ref are required';
  end if;
  if coalesce(p_amount_paise, 0) <= 0 then raise exception 'amount must be positive'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = p_org_id) then
    raise exception 'party not in organization';
  end if;

  v_shop := coalesce(
    p_shop_id,
    (select id from public.shops where org_id = p_org_id order by is_primary desc, created_at asc limit 1)
  );
  if v_shop is null then raise exception 'organization has no shop'; end if;

  -- Idempotent insert: a duplicate (org, gateway, gateway_ref) is a no-op.
  insert into public.payments (
    org_id, shop_id, party_id, direction, mode, amount_paise, reference,
    gateway, gateway_ref, status, created_by
  ) values (
    p_org_id, v_shop, p_party_id, 'received', 'upi', p_amount_paise,
    coalesce(p_reference, p_gateway_ref), p_gateway, p_gateway_ref, 'cleared', null
  )
  on conflict (org_id, gateway, gateway_ref) do nothing
  returning id into v_pay;

  if v_pay is null then
    -- already recorded (webhook re-delivery): return the existing id, do not re-post
    select id into v_pay from public.payments
      where org_id = p_org_id and gateway = p_gateway and gateway_ref = p_gateway_ref;
    return v_pay;
  end if;

  -- first time: post the double entry (Dr bank, Cr party)
  perform public.post_entry(p_org_id, v_shop, public.account_id(p_org_id, 'BANK'), null, p_amount_paise, 0, 'payment', v_pay, 'Razorpay receipt');
  perform public.post_entry(p_org_id, v_shop, null, p_party_id, 0, p_amount_paise, 'payment', v_pay, 'Razorpay receipt from party');

  return v_pay;
end; $$;

-- service_role only (the webhook). NOT authenticated — it takes org_id explicitly.
revoke execute on function public.record_gateway_payment(uuid, uuid, bigint, text, text, uuid, text) from public;
grant execute on function public.record_gateway_payment(uuid, uuid, bigint, text, text, uuid, text) to service_role;
