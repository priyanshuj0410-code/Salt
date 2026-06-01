-- 0032: Server-side Schedule H1/X enforcement (SALT-148).
-- Makes the Schedule H1/X dispensing gate defense-in-depth. Until now the gate
-- was enforced ONLY client-side (SALT-005, useCheckout): a sale written by
-- anything other than the current UI (or a future bug) could dispense an H1/X
-- drug with no register row and no rejection. This migration:
--   (a) lets create_sales_invoice accept structured Rx details
--       (doctor_name, doctor_reg_no, patient_name, patient_address);
--   (b) writes an h1_register row for every H1/X sale_line in the SAME
--       transaction, linked to the real sale_invoice_id + sale_line_id; and
--   (c) calls enforce_h1_gate(v_inv) before returning, so an incomplete
--       prescription raises and the whole invoice rolls back atomically — no
--       partial stock or ledger movement. This unblocks SALT-065 (the H1/X
--       register screen), which has nothing to show until these rows are written.
--
-- enforce_h1_gate is also strengthened: it now requires a COMPLETE register
-- entry (doctor name + patient name + address), not merely that a row exists.
--
-- The 0014–0024 backbone is already live, so this migration only REPLACES the
-- two functions; it does not (re)create any table.
--   * sales_invoices / sale_lines / create_sales_invoice  → proposed/0018 (live)
--   * h1_register / record_h1_entry / enforce_h1_gate      → proposed/0022 (live)
--   * items.schedule (OTC|H|H1|X)                          → migration 0004 (live)
--
-- Plain Schedule H is intentionally NOT gated (no separate register) — match the
-- ('H1','X') predicate. Money stays integer paise. Reuses the is_member RLS
-- already on h1_register. Run after 0031.

-- 1. Strengthen the gate -----------------------------------------------------
-- Raise unless every H1/X line has a register entry that is actually complete.
create or replace function public.enforce_h1_gate(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.sale_lines sl
    join public.items i on i.id = sl.item_id
    where sl.invoice_id = p_invoice and i.schedule in ('H1', 'X')
      and not exists (
        select 1 from public.h1_register h
        where h.sale_line_id = sl.id
          and coalesce(h.doctor_name, '')     <> ''
          and coalesce(h.patient_name, '')    <> ''
          and coalesce(h.patient_address, '') <> ''
      )
  ) then
    raise exception 'Schedule H1/X items on this invoice need a completed H1 register entry (doctor name, patient name and address)';
  end if;
end; $$;

-- 2. create_sales_invoice with structured Rx details + H1 register wiring -----
-- The argument list grows (adds p_doctor_reg_no / p_patient_name /
-- p_patient_address), so drop the old 8-arg signature first — CREATE OR REPLACE
-- would otherwise leave a stale overload and make the PostgREST RPC ambiguous.
drop function if exists public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, text, text);

create or replace function public.create_sales_invoice(
  p_shop_id uuid,
  p_party_id uuid,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_invoice_no text default null,
  p_doctor_name text default null,
  p_doctor_reg_no text default null,
  p_patient_name text default null,
  p_patient_address text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid;
  v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb; v_line_id uuid; v_schedule text;
  v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_gross bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
  v_cgst bigint; v_sgst bigint; v_igst bigint; v_cost bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
  v_paid bigint := 0; v_due date := null; v_pay_code text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;

  -- intra-state (CGST+SGST) unless the party is in a different state (IGST)
  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  if p_payment_method = 'cash' then v_pay_code := 'CASH';
  elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
  elsif p_payment_method = 'credit' then
    v_pay_code := null;
    if p_party_id is null then raise exception 'credit sale requires a party'; end if;
  else raise exception 'invalid payment method %', p_payment_method;
  end if;

  insert into public.sales_invoices (
    org_id, shop_id, party_id, invoice_no, status, payment_method, credit_days,
    is_interstate, doctor_name, notes, created_by
  ) values (
    v_org, p_shop_id, p_party_id, p_invoice_no, 'placed', p_payment_method, p_credit_days,
    not v_intra, p_doctor_name, p_notes, auth.uid()
  ) returning id into v_inv;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);

    -- back MRP-inclusive tax out of the gross line total
    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;  -- remainder to SGST
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;

    insert into public.sale_lines (
      org_id, invoice_id, item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
      discount_type, discount_value, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise
    ) values (
      v_org, v_inv, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, coalesce((v_line->>'rate_paise')::bigint, 0),
      v_line->>'discount_type', coalesce((v_line->>'discount_value')::numeric, 0),
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_gross
    ) returning id into v_line_id;

    -- move stock from the matching batch (guarded against oversell) + log movement
    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty - v_qty
          where id = v_batch_id and org_id = v_org and qty >= v_qty
          returning ptr_paise into v_cost;
      else
        update public.batches set qty = qty - v_qty
          where org_id = v_org and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch_no, '') and qty >= v_qty
          returning id, ptr_paise into v_batch_id, v_cost;
      end if;
      if not found then
        raise exception 'insufficient stock for item % batch %', v_item, coalesce(v_batch_no, '');
      end if;

      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by
      ) values (
        v_org, p_shop_id, v_item, v_batch_id, -v_qty, 'sale', coalesce(v_cost, 0), 'sales_invoice', v_inv, auth.uid()
      );
    end if;

    -- Schedule H1/X: log the dispensing in h1_register in the same transaction.
    -- enforce_h1_gate (below) rolls the whole invoice back if any entry is
    -- incomplete. Plain H is not gated. Ad-hoc lines (no item_id) carry no
    -- schedule, so they cannot be a scheduled drug here.
    if v_item is not null then
      select schedule into v_schedule from public.items where id = v_item and org_id = v_org;
      if v_schedule in ('H1', 'X') then
        insert into public.h1_register (
          org_id, shop_id, sale_invoice_id, sale_line_id, item_id, drug_name, schedule,
          batch_no, expiry, qty, doctor_name, doctor_reg_no, patient_name, patient_address, pharmacist_id
        ) values (
          v_org, p_shop_id, v_inv, v_line_id, v_item, coalesce(v_line->>'name', ''), v_schedule,
          v_batch_no, v_line->>'expiry', v_qty,
          p_doctor_name, p_doctor_reg_no, p_patient_name, p_patient_address, auth.uid()
        );
      end if;
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_gross;
  end loop;

  if v_pay_code is not null then
    v_paid := t_total;
  else
    v_paid := 0;
    if coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
  end if;

  update public.sales_invoices set
    subtotal_paise = t_total, taxable_paise = t_taxable,
    cgst_paise = t_cgst, sgst_paise = t_sgst, igst_paise = t_igst,
    total_paise = t_total, paid_paise = v_paid, due_date = v_due
  where id = v_inv;

  -- double entry: Dr cash/bank (paid) OR Dr party (credit) = Cr Sales + Cr GST output
  if v_pay_code is not null then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_pay_code), null, t_total, 0, 'sales_invoice', v_inv, 'Sale');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, t_total, 0, 'sales_invoice', v_inv, 'Credit sale');
  end if;
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SALES'),    null, 0, t_taxable, 'sales_invoice', v_inv, 'Sale');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_OUT'), null, 0, t_cgst, 'sales_invoice', v_inv, 'CGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_OUT'), null, 0, t_sgst, 'sales_invoice', v_inv, 'SGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_OUT'), null, 0, t_igst, 'sales_invoice', v_inv, 'IGST output');

  -- Hard gate: refuse the whole invoice if any H1/X line lacks a complete
  -- prescription record. Runs last; the entire transaction rolls back on raise.
  perform public.enforce_h1_gate(v_inv);

  return v_inv;
end; $$;

grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, text, text, text, text, text) to authenticated;
