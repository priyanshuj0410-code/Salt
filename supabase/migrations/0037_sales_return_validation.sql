-- 0037: Sales return — guard against over-returning a bill (SALT-015).
-- The sales-return backbone already exists and is LIVE: credit_notes /
-- credit_note_lines + create_credit_note (proposed/0020) — "credit note" is the
-- GST term for a sales return. It restocks the batch (stock_movements +qty,
-- reason 'sale_return'), posts the reverse double entry (Dr Sales Return + Dr GST
-- output · Cr cash/bank/party), and supports refund modes. What was MISSING is
-- SALT-015's core rule: a return line must not exceed what was sold (minus what
-- was already returned), and the line was never linked back to the original
-- sale_line. This migration adds both, with no signature change (the p_lines
-- contract gains an optional sale_line_id key).
--
-- Unblocks the returns counter UI (look up bill -> pick lines + qty -> refund).
-- GSTR-1 CDNR pick-up of credit notes stays a gst-lane follow-on (SALT-002).
-- Money integer paise; same is_member RLS. Run after 0036.

-- p_lines: [{sale_line_id?, item_id, batch_id, name, batch_no, expiry, qty,
--            rate_paise, gst_rate, line_total_paise}]
-- p_refund_mode: 'cash' | 'bank' | 'credit' (credit = reduce party receivable)
create or replace function public.create_credit_note(
  p_shop_id uuid, p_party_id uuid, p_sale_invoice_id uuid, p_reason text,
  p_refund_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_sale_line_id uuid; v_sold_qty integer; v_returned_qty integer;
  v_gross bigint; v_rate numeric; v_taxable bigint; v_tax bigint; v_cgst bigint; v_sgst bigint; v_igst bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  select state_code into v_shop_state from public.shops where id = p_shop_id and org_id = v_org;
  if not found then raise exception 'shop not in organization'; end if;
  if p_party_id is not null then
    select state_code into v_party_state from public.ledgers where id = p_party_id and org_id = v_org;
    if not found then raise exception 'party not in organization'; end if;
  end if;
  v_intra := (p_party_id is null) or (v_party_state is null) or (v_party_state = v_shop_state);

  insert into public.credit_notes (org_id, shop_id, party_id, sale_invoice_id, note_no, reason, is_interstate, notes, created_by)
  values (v_org, p_shop_id, p_party_id, p_sale_invoice_id, p_note_no, p_reason, not v_intra, p_notes, auth.uid())
  returning id into v_note;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_batch_id := nullif(v_line->>'batch_id', '')::uuid;
    v_batch_no := v_line->>'batch_no';
    v_qty := coalesce((v_line->>'qty')::integer, 0);
    v_sale_line_id := nullif(v_line->>'sale_line_id', '')::uuid;

    -- Return against the original bill: a line tied to a sale_line cannot return
    -- more than was sold minus what earlier (placed) credit notes already returned.
    if v_sale_line_id is not null then
      select qty into v_sold_qty from public.sale_lines
        where id = v_sale_line_id and org_id = v_org
          and (p_sale_invoice_id is null or invoice_id = p_sale_invoice_id);
      if not found then
        raise exception 'sale line % is not on the invoice being returned', v_sale_line_id;
      end if;
      select coalesce(sum(cnl.qty), 0) into v_returned_qty
        from public.credit_note_lines cnl
        join public.credit_notes cn on cn.id = cnl.credit_note_id
        where cnl.sale_line_id = v_sale_line_id and cn.org_id = v_org and cn.status = 'placed';
      if v_qty > v_sold_qty - v_returned_qty then
        raise exception 'return qty % exceeds returnable % for sale line % (sold %, already returned %)',
          v_qty, greatest(v_sold_qty - v_returned_qty, 0), v_sale_line_id, v_sold_qty, v_returned_qty;
      end if;
    end if;

    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.credit_note_lines (
      org_id, credit_note_id, sale_line_id, item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
      taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    values (v_org, v_note, v_sale_line_id, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
      v_qty, coalesce((v_line->>'rate_paise')::bigint, 0), v_taxable, v_rate, v_cgst, v_sgst, v_igst, v_gross);

    -- stock back in
    if v_item is not null and v_qty > 0 then
      if v_batch_id is not null then
        update public.batches set qty = qty + v_qty where id = v_batch_id and org_id = v_org returning id into v_batch_id;
      else
        update public.batches set qty = qty + v_qty
          where org_id = v_org and shop_id = p_shop_id and item_id = v_item and coalesce(batch_no, '') = coalesce(v_batch_no, '')
          returning id into v_batch_id;
      end if;
      if not found then
        insert into public.batches (org_id, shop_id, item_id, batch_no, expiry, qty)
        values (v_org, p_shop_id, v_item, v_batch_no, nullif(v_line->>'expiry', ''), v_qty) returning id into v_batch_id;
      end if;
      insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, ref_table, ref_id, created_by)
      values (v_org, p_shop_id, v_item, v_batch_id, v_qty, 'sale_return', 'credit_note', v_note, auth.uid());
    end if;

    t_taxable := t_taxable + v_taxable; t_cgst := t_cgst + v_cgst; t_sgst := t_sgst + v_sgst;
    t_igst := t_igst + v_igst; t_total := t_total + v_gross;
  end loop;

  update public.credit_notes set taxable_paise = t_taxable, cgst_paise = t_cgst, sgst_paise = t_sgst,
    igst_paise = t_igst, total_paise = t_total where id = v_note;

  -- reverse the sale: Dr Sales Return + Dr GST output = Cr party (or refund cash/bank)
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SALES_RET'), null, t_taxable, 0, 'credit_note', v_note, 'Sales return');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CGST_OUT'), null, t_cgst, 0, 'credit_note', v_note, 'CGST output reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'SGST_OUT'), null, t_sgst, 0, 'credit_note', v_note, 'SGST output reversal');
  perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'IGST_OUT'), null, t_igst, 0, 'credit_note', v_note, 'IGST output reversal');
  if p_refund_mode = 'cash' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'CASH'), null, 0, t_total, 'credit_note', v_note, 'Cash refund');
  elsif p_refund_mode = 'bank' then
    perform public.post_entry(v_org, p_shop_id, public.account_id(v_org, 'BANK'), null, 0, t_total, 'credit_note', v_note, 'Bank refund');
  else
    if p_party_id is null then raise exception 'credit-mode return requires a party'; end if;
    perform public.post_entry(v_org, p_shop_id, null, p_party_id, 0, t_total, 'credit_note', v_note, 'Return to party account');
  end if;

  return v_note;
end; $$;

grant execute on function public.create_credit_note(uuid, uuid, uuid, text, text, jsonb, text, text) to authenticated;
