-- 0050: attribute a sales invoice to a salesman (SALT-218, unblocks SALT-192).
-- sales_invoices.salesman_id exists (0024) + the commission report reads it, but
-- create_sales_invoice never set it. Adds a trailing p_salesman_id uuid (default
-- null → today's behaviour unchanged), validates it belongs to the org + active,
-- and writes it on the invoice. CUMULATIVE on the current chain (0034 tenders →
-- 0045 idempotency): body reproduced verbatim from 0045 with only the salesman
-- param + validation + insert column added. Drop the 14-arg signature first so
-- PostgREST does not see a stale overload. Money integer paise. Run after 0049.

drop function if exists public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, uuid, text, text, text, text, text, jsonb, uuid);

create or replace function public.create_sales_invoice(
  p_shop_id uuid,
  p_party_id uuid,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_invoice_no text default null,
  p_series_id uuid default null,
  p_doctor_name text default null,
  p_doctor_reg_no text default null,
  p_patient_name text default null,
  p_patient_address text default null,
  p_notes text default null,
  p_tenders jsonb default null,
  p_idempotency_key uuid default null,
  p_salesman_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid; v_invoice_no text; v_series_code text; v_method text; v_idem uuid;
  v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb; v_line_id uuid; v_schedule text;
  v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_gross bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
  v_cgst bigint; v_sgst bigint; v_igst bigint; v_cost bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
  v_paid bigint := 0; v_due date := null; v_pay_code text;
  v_has_tenders boolean;
  v_tender_total bigint; v_cash_total bigint; v_bank_total bigint; v_credit_total bigint;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  -- idempotent replay: return the original invoice without re-posting
  if p_idempotency_key is not null then
    select ref_id into v_idem from public.idempotency_keys where org_id = v_org and key = p_idempotency_key;
    if found then return v_idem; end if;
    insert into public.idempotency_keys (org_id, key, ref_table) values (v_org, p_idempotency_key, 'sales_invoice');
  end if;

  if p_salesman_id is not null and not exists (
       select 1 from public.salesmen where id = p_salesman_id and org_id = v_org and is_active) then
    raise exception 'salesman not in organization or inactive';
  end if;

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;

  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  v_has_tenders := p_tenders is not null and jsonb_typeof(p_tenders) = 'array' and jsonb_array_length(p_tenders) > 0;

  if v_has_tenders then
    if exists (select 1 from jsonb_array_elements(p_tenders) e
               where coalesce(e->>'mode','') not in ('cash','card','upi','bank','credit')) then
      raise exception 'invalid tender mode';
    end if;
    if p_party_id is null and exists (select 1 from jsonb_array_elements(p_tenders) e where e->>'mode' = 'credit') then
      raise exception 'credit tender requires a party';
    end if;
    v_method := case when jsonb_array_length(p_tenders) > 1 then 'split' else p_tenders->0->>'mode' end;
  else
    if p_payment_method = 'cash' then v_pay_code := 'CASH';
    elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
    elsif p_payment_method = 'credit' then
      v_pay_code := null;
      if p_party_id is null then raise exception 'credit sale requires a party'; end if;
    else raise exception 'invalid payment method %', p_payment_method;
    end if;
    v_method := p_payment_method;
  end if;

  v_invoice_no := nullif(p_invoice_no, '');
  if v_invoice_no is null then
    if p_series_id is not null then
      select code into v_series_code from public.invoice_series
        where id = p_series_id and org_id = v_org and shop_id = p_shop_id and doc_type = 'sales_invoice';
      if not found then raise exception 'invoice series not found for this shop'; end if;
    else
      select code into v_series_code from public.invoice_series
        where org_id = v_org and shop_id = p_shop_id and doc_type = 'sales_invoice' and active and is_default
        order by financial_year desc limit 1;
      v_series_code := coalesce(v_series_code, 'DEFAULT');
    end if;
    v_invoice_no := public.next_doc_no(p_shop_id, 'sales_invoice', v_series_code);
  end if;

  insert into public.sales_invoices (
    org_id, shop_id, party_id, invoice_no, status, payment_method, credit_days,
    is_interstate, doctor_name, notes, salesman_id, created_by
  ) values (
    v_org, p_shop_id, p_party_id, v_invoice_no, 'placed', v_method, p_credit_days,
    not v_intra, p_doctor_name, p_notes, p_salesman_id, auth.uid()
  ) returning id into v_inv;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);

    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
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

  if v_has_tenders then
    select
      coalesce(sum((e->>'amount_paise')::bigint), 0),
      coalesce(sum((e->>'amount_paise')::bigint) filter (where e->>'mode' = 'cash'), 0),
      coalesce(sum((e->>'amount_paise')::bigint) filter (where e->>'mode' in ('card','upi','bank')), 0),
      coalesce(sum((e->>'amount_paise')::bigint) filter (where e->>'mode' = 'credit'), 0)
      into v_tender_total, v_cash_total, v_bank_total, v_credit_total
      from jsonb_array_elements(p_tenders) e;
    if v_tender_total <> t_total then
      raise exception 'tenders (% paise) must sum to invoice total (% paise)', v_tender_total, t_total;
    end if;
    insert into public.sale_tenders (org_id, invoice_id, mode, amount_paise, reference)
    select v_org, v_inv, e->>'mode', coalesce((e->>'amount_paise')::bigint, 0), e->>'reference'
    from jsonb_array_elements(p_tenders) e;
    v_paid := v_cash_total + v_bank_total;
    if v_credit_total > 0 and coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
  else
    if v_pay_code is not null then
      v_paid := t_total;
    else
      v_paid := 0;
      if coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
    end if;
  end if;

  update public.sales_invoices set
    subtotal_paise = t_total, taxable_paise = t_taxable,
    cgst_paise = t_cgst, sgst_paise = t_sgst, igst_paise = t_igst,
    total_paise = t_total, paid_paise = v_paid, due_date = v_due
  where id = v_inv;

  if v_has_tenders then
    if v_cash_total > 0 then
      perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CASH'), null, v_cash_total, 0, 'sales_invoice', v_inv, 'Sale (cash)');
    end if;
    if v_bank_total > 0 then
      perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'BANK'), null, v_bank_total, 0, 'sales_invoice', v_inv, 'Sale (bank)');
    end if;
    if v_credit_total > 0 then
      perform public.post_entry(v_org, p_shop_id, null, p_party_id, v_credit_total, 0, 'sales_invoice', v_inv, 'Credit sale');
    end if;
  elsif v_pay_code is not null then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_pay_code), null, t_total, 0, 'sales_invoice', v_inv, 'Sale');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, t_total, 0, 'sales_invoice', v_inv, 'Credit sale');
  end if;
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SALES'),    null, 0, t_taxable, 'sales_invoice', v_inv, 'Sale');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_OUT'), null, 0, t_cgst, 'sales_invoice', v_inv, 'CGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_OUT'), null, 0, t_sgst, 'sales_invoice', v_inv, 'SGST output');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_OUT'), null, 0, t_igst, 'sales_invoice', v_inv, 'IGST output');

  perform public.enforce_h1_gate(v_inv);

  if p_idempotency_key is not null then
    update public.idempotency_keys set ref_id = v_inv where org_id = v_org and key = p_idempotency_key;
  end if;
  return v_inv;
end; $$;
grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, uuid, text, text, text, text, text, jsonb, uuid, uuid) to authenticated;
