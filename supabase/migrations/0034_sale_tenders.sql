-- 0034: Split-tender payment on a sales invoice (SALT-011, phase 1).
-- One bill can be settled by multiple tenders (e.g. 200 cash + 300 UPI + 500
-- credit) instead of a single payment_method. Adds a sale_tenders table and a
-- p_tenders path in create_sales_invoice. Backward-compatible: when p_tenders is
-- null/empty the original single p_payment_method behaviour is used unchanged, so
-- the current billing client keeps working until the split-pay UI ships.
--
-- create_sales_invoice here is CUMULATIVE on 0033 (keeps the FY-scoped invoice
-- numbering) and 0032 (keeps the Schedule H1/X gate). Money is integer paise; RLS
-- via is_member. Run after 0033.
--
-- Phase 2 (UPI gateway auto-confirm) is NOT built here. The real auto-confirm
-- path is the Razorpay webhook -> record_payment work in SALT-169; a UPI status
-- table would hang off that, so it is intentionally deferred rather than stubbed.

-- 1. sale_tenders: the per-bill payment breakdown -----------------------------
create table public.sale_tenders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.sales_invoices (id) on delete cascade,
  mode text not null check (mode in ('cash', 'card', 'upi', 'bank', 'credit')),
  amount_paise bigint not null default 0,
  reference text,                            -- UPI ref / card auth / cheque no
  created_at timestamptz not null default now()
);
create index sale_tenders_invoice_idx on public.sale_tenders (invoice_id);
create index sale_tenders_org_idx on public.sale_tenders (org_id);

alter table public.sale_tenders enable row level security;
create policy "sale_tenders read"   on public.sale_tenders for select using (public.is_member(org_id));
create policy "sale_tenders insert" on public.sale_tenders for insert with check (public.is_member(org_id));
create policy "sale_tenders update" on public.sale_tenders for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "sale_tenders delete" on public.sale_tenders for delete using (public.is_member(org_id));

-- 2. create_sales_invoice with optional split tenders -------------------------
-- p_tenders: [{mode, amount_paise, reference?}] — must sum to the invoice total.
-- When supplied: paid_paise = sum of non-credit tenders; any credit portion sets
-- due_date and leaves the remainder unpaid; the debit side splits across the
-- cash/bank accounts and the party. When null: the single p_payment_method path.
drop function if exists public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, uuid, text, text, text, text, text);

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
  p_tenders jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid; v_invoice_no text; v_series_code text; v_method text;
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

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;

  -- intra-state (CGST+SGST) unless the party is in a different state (IGST)
  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  v_has_tenders := p_tenders is not null and jsonb_typeof(p_tenders) = 'array' and jsonb_array_length(p_tenders) > 0;

  if v_has_tenders then
    -- validate modes + credit-requires-party up front; the SUM is validated
    -- after the line loop (it must equal the computed invoice total).
    if exists (select 1 from jsonb_array_elements(p_tenders) e
               where coalesce(e->>'mode','') not in ('cash','card','upi','bank','credit')) then
      raise exception 'invalid tender mode';
    end if;
    if p_party_id is null and exists (select 1 from jsonb_array_elements(p_tenders) e where e->>'mode' = 'credit') then
      raise exception 'credit tender requires a party';
    end if;
    v_method := case when jsonb_array_length(p_tenders) > 1 then 'split' else p_tenders->0->>'mode' end;
  else
    -- single-method path (unchanged from 0033)
    if p_payment_method = 'cash' then v_pay_code := 'CASH';
    elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
    elsif p_payment_method = 'credit' then
      v_pay_code := null;
      if p_party_id is null then raise exception 'credit sale requires a party'; end if;
    else raise exception 'invalid payment method %', p_payment_method;
    end if;
    v_method := p_payment_method;
  end if;

  -- Invoice number: caller override wins; else allocate from the chosen series
  -- (p_series_id) or the shop's default active sales series. Gap-free per FY.
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
    is_interstate, doctor_name, notes, created_by
  ) values (
    v_org, p_shop_id, p_party_id, v_invoice_no, 'placed', v_method, p_credit_days,
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

  -- Settle: split tenders (validated to sum to total) or the single method.
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

  -- double entry, debit side: Dr cash/bank/party (split for tenders) =
  -- Cr Sales + Cr GST output.
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

  -- Hard gate: refuse the whole invoice if any H1/X line lacks a complete
  -- prescription record. Runs last; the entire transaction rolls back on raise.
  perform public.enforce_h1_gate(v_inv);

  return v_inv;
end; $$;

grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, uuid, text, text, text, text, text, jsonb) to authenticated;
