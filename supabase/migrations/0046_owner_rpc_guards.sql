-- 0046: gate the owner-only SECURITY DEFINER write RPCs on has_role (SALT-208).
-- Closes the FR-U-012 follow-on from SALT-199: table RLS (0044) blocks direct
-- PostgREST access, but SECURITY DEFINER write RPCs bypass RLS, so a cashier JWT
-- could still invoke them. The import loaders (import_catalog/import_gl_opening)
-- ALREADY check owner role; this adds the same guard to the two that did not:
-- receive_purchase and create_debit_note. Both are unchanged otherwise — same
-- signature, so plain create-or-replace (no drop/grant change). The body is
-- reproduced verbatim from its current definition (receive_purchase 0019,
-- create_debit_note 0045) with ONLY the has_role guard inserted after the org is
-- resolved. The cashier POS RPCs stay ungated (create_sales_invoice,
-- create_credit_note, hold/resume/discard_bill, record_payment,
-- record_gateway_payment). Money integer paise. Run after 0045.

-- 1. receive_purchase (verbatim from 0019 + owner guard) ----------------------
create or replace function public.receive_purchase(
  p_shop_id uuid,
  p_vendor_id uuid,
  p_vendor_invoice_no text,
  p_vendor_invoice_date date,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_po_id uuid default null,
  p_grn_no text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_grn uuid;
  v_intra boolean; v_shop_state text; v_vendor_state text;
  v_line jsonb;
  v_item uuid; v_batch_no text; v_qty integer; v_free integer; v_stock_qty integer;
  v_ptr bigint; v_mrp bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
  v_cgst bigint; v_sgst bigint; v_igst bigint; v_batch_id uuid;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
  v_paid bigint := 0; v_due date := null; v_pay_code text;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not public.has_role(v_org, 'owner') then raise exception 'recording a purchase is owner-only'; end if;

  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;

  select state_code into v_vendor_state from public.ledgers where id = p_vendor_id and org_id = v_org;
  if not found then raise exception 'vendor not in organization'; end if;

  v_intra := (v_vendor_state is null) or (v_vendor_state = v_shop_state);

  if p_payment_method = 'cash' then v_pay_code := 'CASH';
  elsif p_payment_method in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
  elsif p_payment_method = 'credit' then v_pay_code := null;
  else raise exception 'invalid payment method %', p_payment_method;
  end if;

  insert into public.purchases (
    org_id, shop_id, vendor_id, po_id, grn_no, vendor_invoice_no, vendor_invoice_date,
    is_interstate, notes, created_by
  ) values (
    v_org, p_shop_id, p_vendor_id, p_po_id, p_grn_no, p_vendor_invoice_no, p_vendor_invoice_date,
    not v_intra, p_notes, auth.uid()
  ) returning id into v_grn;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_free := coalesce((v_line->>'free_qty')::integer, 0);
    v_ptr := coalesce((v_line->>'ptr_paise')::bigint, 0);
    v_mrp := coalesce((v_line->>'mrp_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    -- taxable is tax-exclusive: take it if supplied, else qty * ptr
    v_taxable := coalesce(nullif((v_line->>'taxable_paise'), '')::bigint, v_qty * v_ptr);
    v_tax := round(v_taxable * v_rate / 100.0);
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;

    insert into public.purchase_lines (
      org_id, purchase_id, item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, mrp_paise,
      discount_type, discount_value, scheme_text, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise
    ) values (
      v_org, v_grn, v_item, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, v_free, v_ptr, v_mrp,
      v_line->>'discount_type', coalesce((v_line->>'discount_value')::numeric, 0), v_line->>'scheme_text',
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_taxable + v_tax
    );

    -- add stock: free goods land in stock too (effective cost spreads over qty+free)
    v_stock_qty := v_qty + v_free;
    if v_item is not null and v_stock_qty > 0 then
      update public.batches set
        qty = qty + v_stock_qty,
        ptr_paise = coalesce(nullif(v_ptr, 0)::integer, ptr_paise),
        mrp_paise = coalesce(nullif(v_mrp, 0)::integer, mrp_paise),
        expiry = coalesce(nullif(v_line->>'expiry', ''), expiry)
        where org_id = v_org and shop_id = p_shop_id and item_id = v_item
          and coalesce(batch_no, '') = coalesce(v_batch_no, '')
        returning id into v_batch_id;
      if not found then
        insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
        values (v_org, p_shop_id, v_item, v_batch_no, nullif(v_line->>'expiry', ''), v_stock_qty, v_mrp::integer, v_ptr::integer)
        returning id into v_batch_id;
      end if;

      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by
      ) values (
        v_org, p_shop_id, v_item, v_batch_id, v_stock_qty, 'purchase', v_ptr, 'purchase', v_grn, auth.uid()
      );
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_taxable + v_tax;
  end loop;

  if v_pay_code is not null then
    v_paid := t_total;
  else
    v_paid := 0;
    if coalesce(p_credit_days, 0) > 0 then v_due := current_date + p_credit_days; end if;
  end if;

  update public.purchases set
    subtotal_paise = t_taxable, taxable_paise = t_taxable,
    cgst_paise = t_cgst, sgst_paise = t_sgst, igst_paise = t_igst,
    total_paise = t_total, paid_paise = v_paid
  where id = v_grn;

  if p_po_id is not null then
    update public.purchase_orders set status = 'received' where id = p_po_id and org_id = v_org;
  end if;

  -- double entry: Dr Purchase + Dr GST input (ITC) = Cr vendor (or Cr cash/bank if paid)
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'PURCHASE'), null, t_taxable, 0, 'purchase', v_grn, 'Purchase');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_IN'), null, t_cgst, 0, 'purchase', v_grn, 'CGST input');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_IN'), null, t_sgst, 0, 'purchase', v_grn, 'SGST input');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_IN'), null, t_igst, 0, 'purchase', v_grn, 'IGST input');
  if v_pay_code is not null then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, v_pay_code), null, 0, t_total, 'purchase', v_grn, 'Purchase paid');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_vendor_id, 0, t_total, 'purchase', v_grn, 'Purchase on credit');
  end if;

  return v_grn;
end; $$;

-- 2. create_debit_note (verbatim from 0045 + owner guard) ---------------------
create or replace function public.create_debit_note(
  p_shop_id uuid, p_vendor_id uuid, p_purchase_id uuid, p_reason text,
  p_settle_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null,
  p_idempotency_key uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_vendor_state text; v_idem uuid;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_ptr bigint; v_rate numeric; v_taxable bigint; v_tax bigint; v_cgst bigint; v_sgst bigint; v_igst bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not public.has_role(v_org, 'owner') then raise exception 'a debit note is owner-only'; end if;
  if p_idempotency_key is not null then
    select ref_id into v_idem from public.idempotency_keys where org_id = v_org and key = p_idempotency_key;
    if found then return v_idem; end if;
    insert into public.idempotency_keys (org_id, key, ref_table) values (v_org, p_idempotency_key, 'debit_note');
  end if;
  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;
  select state_code into v_vendor_state from public.ledgers where id = p_vendor_id and org_id = v_org;
  if not found then raise exception 'vendor not in organization'; end if;
  v_intra := (v_vendor_state is null) or (v_vendor_state = v_shop_state);

  insert into public.debit_notes (org_id, shop_id, vendor_id, purchase_id, note_no, reason, is_interstate, notes, created_by)
  values (v_org, p_shop_id, p_vendor_id, p_purchase_id, p_note_no, p_reason, not v_intra, p_notes, auth.uid())
  returning id into v_note;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_ptr := coalesce((v_line->>'ptr_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    v_taxable := coalesce(nullif((v_line->>'taxable_paise'), '')::bigint, v_qty * v_ptr);
    v_tax := round(v_taxable * v_rate / 100.0);
    if v_intra then v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.debit_note_lines (
      org_id, debit_note_id, item_id, batch_id, name, batch_no, qty, ptr_paise,
      taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    values (v_org, v_note, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_qty, v_ptr,
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_taxable + v_tax);

    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty - v_qty where id = v_batch_id and org_id = v_org and qty >= v_qty returning id into v_batch_id;
      else
        update public.batches set qty = qty - v_qty
          where org_id = v_org and shop_id = p_shop_id and item_id = v_item
            and coalesce(batch_no, '') = coalesce(v_batch_no, '') and qty >= v_qty
          returning id into v_batch_id;
      end if;
      if not found then raise exception 'insufficient stock to return for item %', v_item; end if;
      insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by)
      values (v_org, p_shop_id, v_item, v_batch_id, -v_qty, 'purchase_return', v_ptr, 'debit_note', v_note, auth.uid());
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_taxable + v_tax;
  end loop;

  update public.debit_notes set taxable_paise = t_taxable, cgst_paise = t_cgst, sgst_paise = t_sgst,
    igst_paise = t_igst, itc_reversal_paise = t_cgst + t_sgst + t_igst, total_paise = t_total where id = v_note;

  if p_settle_mode = 'cash' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CASH'), null, t_total, 0, 'debit_note', v_note, 'Vendor cash refund');
  elsif p_settle_mode = 'bank' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'BANK'), null, t_total, 0, 'debit_note', v_note, 'Vendor bank refund');
  else
    perform public.post_entry(v_org, p_shop_id, null, p_vendor_id, t_total, 0, 'debit_note', v_note, 'Reduce vendor payable');
  end if;
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'PUR_RET'), null, 0, t_taxable, 'debit_note', v_note, 'Purchase return');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_IN'), null, 0, t_cgst, 'debit_note', v_note, 'CGST ITC reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_IN'), null, 0, t_sgst, 'debit_note', v_note, 'SGST ITC reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_IN'), null, 0, t_igst, 'debit_note', v_note, 'IGST ITC reversal');

  if p_idempotency_key is not null then
    update public.idempotency_keys set ref_id = v_note where org_id = v_org and key = p_idempotency_key;
  end if;
  return v_note;
end; $$;
