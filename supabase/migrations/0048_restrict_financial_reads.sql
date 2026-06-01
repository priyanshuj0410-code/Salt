-- 0048: restrict payments + sales_invoices reads to financial roles / own bills
-- (SALT-213). Completes FR-U-012: a cashier should not read the org's whole
-- financial history via PostgREST. SELECT is gated to a financial role
-- (owner/manager/accountant) OR the caller's own rows (created_by); writes stay
-- owner-only (sales_invoices INSERT stays member-level because it is created via
-- the create_sales_invoice definer RPC, which bypasses RLS anyway).
--
-- ⚠️ RUN ORDER: apply this ONLY AFTER the billing client switches the
-- credit-limit check (lib/credit.ts fetchPartyCredit) to the party_credit RPC
-- (0047) — see the billing follow-on ticket. Until then, the cashier credit
-- warning reads these tables directly and this migration would make it undercount
-- a party's dues (it would see only the cashier's own bills). The party_credit
-- RPC is SECURITY DEFINER so it keeps working after this. Run after 0047.
--
-- Robust + idempotent: drop every existing policy per table, recreate role-aware
-- ones. Financial roles use has_any_role (0047); only 'owner' exists today, so
-- manager/accountant are forward-compat. created_by exists on both tables.

-- payments -------------------------------------------------------------------
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'payments' loop
    execute format('drop policy %I on public.payments', p.policyname);
  end loop;
end $$;
create policy "payments read"   on public.payments for select
  using (public.has_any_role(org_id, array['owner','manager','accountant']) or created_by = auth.uid());
create policy "payments insert" on public.payments for insert with check (public.has_role(org_id, 'owner'));
create policy "payments update" on public.payments for update using (public.has_role(org_id, 'owner')) with check (public.has_role(org_id, 'owner'));
create policy "payments delete" on public.payments for delete using (public.has_role(org_id, 'owner'));

-- sales_invoices -------------------------------------------------------------
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'sales_invoices' loop
    execute format('drop policy %I on public.sales_invoices', p.policyname);
  end loop;
end $$;
-- SELECT: financial role OR your own bills (useCheckout reads its just-created
-- invoice_no — the caller's own row — so that still works).
create policy "sales_invoices read"   on public.sales_invoices for select
  using (public.has_any_role(org_id, array['owner','manager','accountant']) or created_by = auth.uid());
-- INSERT stays member-level: writes go through create_sales_invoice (definer),
-- and a cashier must be able to create a bill.
create policy "sales_invoices insert" on public.sales_invoices for insert with check (public.is_member(org_id));
-- UPDATE/DELETE (voiding/editing a posted invoice) are owner-only.
create policy "sales_invoices update" on public.sales_invoices for update using (public.has_role(org_id, 'owner')) with check (public.has_role(org_id, 'owner'));
create policy "sales_invoices delete" on public.sales_invoices for delete using (public.has_role(org_id, 'owner'));
