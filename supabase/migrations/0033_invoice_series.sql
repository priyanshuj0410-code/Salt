-- 0033: Per-shop, FY-scoped, gap-free GST invoice numbering wired into
-- create_sales_invoice — closes SALT-013 AND SALT-176 (reconciled).
--
-- The two tickets overlapped on the same object with contradictory schemas:
--   * SALT-013 (FY-scoped, gap-free, allocated inside create_sales_invoice)
--   * SALT-176 (multiple NAMED series per shop, p_series_id selection)
-- They are unified here. The invoice_series table + a gap-free FY-scoped
-- allocator (next_doc_no) already exist and are LIVE (proposed/0024_settings.sql;
-- proven by 0031 altering the table) but next_doc_no was NEVER called and
-- create_sales_invoice never numbered invoices. This migration:
--   1. extends invoice_series for multiple named series (code/is_default/active)
--      and a configurable zero-pad width;
--   2. makes next_doc_no series-aware (optional p_code, default 'DEFAULT') and
--      width-aware, carrying a series' prefix/width forward across FYs;
--   3. wires create_sales_invoice to allocate invoice_no atomically (optional
--      p_series_id, default = the shop's default active sales series);
--   4. seeds one default series per existing shop.
--
-- create_sales_invoice here is CUMULATIVE on 0032 (keeps the Schedule H1/X gate).
-- Money stays integer paise. RLS on invoice_series is unchanged (is_member, 0024).
-- next_doc_no has zero existing callers, so widening its signature is safe.
-- Run after 0032.

-- 0. Reusable Indian financial-year helper (Apr-Mar) → e.g. '2025-26' ---------
create or replace function public.current_indian_fy(p_date date default current_date)
returns text language sql immutable as $$
  select case
    when extract(month from p_date) >= 4
      then extract(year from p_date)::int || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
      else (extract(year from p_date)::int - 1) || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0')
  end;
$$;
grant execute on function public.current_indian_fy(date) to authenticated;

-- 1. Extend invoice_series for multiple named series + configurable width ------
alter table public.invoice_series
  add column if not exists code         text    not null default 'DEFAULT',  -- 'DEFAULT' | 'RETAIL' | 'WS' | branch code
  add column if not exists is_default   boolean not null default true,
  add column if not exists active       boolean not null default true,
  add column if not exists number_width integer not null default 5;

-- A series is now identified by (org, shop, doc_type, code); the running number
-- still resets per financial_year. Replace the old 4-column unique with one that
-- includes code, so two series can coexist in the same shop + FY.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.invoice_series'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (org_id, shop_id, doc_type, financial_year)';
  if c is not null then execute format('alter table public.invoice_series drop constraint %I', c); end if;
end $$;
create unique index if not exists invoice_series_unique_idx
  on public.invoice_series (org_id, shop_id, doc_type, code, financial_year);

-- 2. Series-aware, width-aware, gap-free allocator ----------------------------
-- Atomically allocate the next number for a (shop, doc_type, code) in the
-- current FY. Gap-free + concurrency-safe: the UPDATE row-locks the counter, and
-- the first-row race (two txns inserting the same new FY/code) is retried via the
-- unique_violation handler. A new FY (or code) inherits prefix/width from the
-- series' most recent prior row, so per-series formatting carries forward.
drop function if exists public.next_doc_no(uuid, text);
create or replace function public.next_doc_no(p_shop uuid, p_doc_type text, p_code text default 'DEFAULT')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_prefix text; v_num integer; v_fy text; v_code text; v_width integer; v_carry_prefix text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  v_code := coalesce(nullif(p_code, ''), 'DEFAULT');
  v_fy := public.current_indian_fy();

  loop
    update public.invoice_series set next_number = next_number + 1
      where org_id = v_org and shop_id = p_shop and doc_type = p_doc_type
        and code = v_code and financial_year = v_fy
      returning prefix, number_width, next_number - 1 into v_prefix, v_width, v_num;
    exit when found;

    -- No counter row for this FY yet: create it, carrying prefix/width forward.
    begin
      select prefix, number_width into v_carry_prefix, v_width
        from public.invoice_series
        where org_id = v_org and shop_id = p_shop and doc_type = p_doc_type and code = v_code
        order by financial_year desc limit 1;
      insert into public.invoice_series (
        org_id, shop_id, doc_type, code, prefix, next_number, financial_year, number_width, is_default, active
      ) values (
        v_org, p_shop, p_doc_type, v_code,
        coalesce(v_carry_prefix, upper(left(p_doc_type, 3))), 2, v_fy,
        coalesce(v_width, 5), v_code = 'DEFAULT', true
      ) returning prefix, number_width, 1 into v_prefix, v_width, v_num;
      exit;
    exception when unique_violation then
      -- a concurrent txn just created the row; loop back and UPDATE it
    end;
  end loop;

  return coalesce(v_prefix, '') || '/' || v_fy || '/' || lpad(v_num::text, coalesce(v_width, 5), '0');
end; $$;
grant execute on function public.next_doc_no(uuid, text, text) to authenticated;

-- 3. create_sales_invoice: allocate invoice_no from the series ----------------
-- Adds p_series_id (optional; default = the shop's default active sales series).
-- A caller-supplied p_invoice_no still wins (manual/import). Otherwise the number
-- is allocated atomically inside the same transaction, so it is gap-free and
-- never reused. CUMULATIVE on 0032: the Schedule H1/X gate is preserved verbatim.
drop function if exists public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, text, text, text, text, text);

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
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid; v_invoice_no text; v_series_code text;
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
    v_org, p_shop_id, p_party_id, v_invoice_no, 'placed', p_payment_method, p_credit_days,
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

grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, uuid, text, text, text, text, text) to authenticated;

-- 4. Backfill: one default sales series per existing shop (current FY) ---------
-- next_doc_no auto-creates counters on first use, but seeding a default makes the
-- series visible to the gst series-management UI (SALT-067) and pins is_default.
insert into public.invoice_series (
  org_id, shop_id, doc_type, code, prefix, next_number, financial_year, number_width, is_default, active
)
select s.org_id, s.id, 'sales_invoice', 'DEFAULT', 'INV', 1, public.current_indian_fy(), 5, true, true
from public.shops s
where not exists (
  select 1 from public.invoice_series isr
  where isr.shop_id = s.id and isr.doc_type = 'sales_invoice'
);
