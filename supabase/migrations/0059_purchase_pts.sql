-- 0059: keep BOTH printed PTR and PTS on a purchase line (feedback). Pharma invoices
-- often print Price-To-Retailer and Price-To-Stockist; the SALT-027 reconciliation kept
-- only the billed one. Now store both, with cost_basis recording which the line was
-- billed/landed on. ptr_paise = printed PTR, pts_paise = printed PTS; the landed cost
-- (stock valuation + tax) uses (cost_basis = 'pts' ? pts_paise : ptr_paise). Run after 0058.

alter table public.purchase_lines
  add column if not exists pts_paise bigint,
  add column if not exists cost_basis text not null default 'ptr';

-- receive_purchase: verbatim from 0046 + (1) read pts_paise/cost_basis, (2) derive the
-- landed cost v_cost from the basis and use it for stock valuation, (3) store both rates.
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
  v_ptr bigint; v_pts bigint; v_basis text; v_cost bigint;
  v_mrp bigint; v_rate numeric; v_taxable bigint; v_tax bigint;
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
    v_ptr := coalesce((v_line->>'ptr_paise')::bigint, 0);          -- printed PTR (stored)
    v_pts := nullif(v_line->>'pts_paise', '')::bigint;            -- printed PTS (stored)
    v_basis := coalesce(v_line->>'cost_basis', 'ptr');
    v_cost := case when v_basis = 'pts' and v_pts is not null then v_pts else v_ptr end; -- billed/landed cost
    v_mrp := coalesce((v_line->>'mrp_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    -- taxable is tax-exclusive: take it if supplied, else qty * landed cost
    v_taxable := coalesce(nullif((v_line->>'taxable_paise'), '')::bigint, v_qty * v_cost);
    v_tax := round(v_taxable * v_rate / 100.0);
    if v_intra then
      v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else
      v_cgst := 0; v_sgst := 0; v_igst := v_tax;
    end if;

    insert into public.purchase_lines (
      org_id, purchase_id, item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, pts_paise, cost_basis, mrp_paise,
      discount_type, discount_value, scheme_text, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise
    ) values (
      v_org, v_grn, v_item, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, v_free, v_ptr, v_pts, v_basis, v_mrp,
      v_line->>'discount_type', coalesce((v_line->>'discount_value')::numeric, 0), v_line->>'scheme_text',
      v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_taxable + v_tax
    );

    -- add stock: free goods land in stock too; the unit cost is the landed rate (v_cost)
    v_stock_qty := v_qty + v_free;
    if v_item is not null and v_stock_qty > 0 then
      update public.batches set
        qty = qty + v_stock_qty,
        ptr_paise = coalesce(nullif(v_cost, 0)::integer, ptr_paise),
        mrp_paise = coalesce(nullif(v_mrp, 0)::integer, mrp_paise),
        expiry = coalesce(nullif(v_line->>'expiry', ''), expiry)
        where org_id = v_org and shop_id = p_shop_id and item_id = v_item
          and coalesce(batch_no, '') = coalesce(v_batch_no, '')
        returning id into v_batch_id;
      if not found then
        insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, qty, mrp_paise, ptr_paise)
        values (v_org, p_shop_id, v_item, v_batch_no, nullif(v_line->>'expiry', ''), v_stock_qty, v_mrp::integer, v_cost::integer)
        returning id into v_batch_id;
      end if;

      insert into public.stock_movements (
        org_id, shop_id, item_id, batch_id, qty_delta, reason, unit_cost_paise, ref_table, ref_id, created_by
      ) values (
        v_org, p_shop_id, v_item, v_batch_id, v_stock_qty, 'purchase', v_cost, 'purchase', v_grn, auth.uid()
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
