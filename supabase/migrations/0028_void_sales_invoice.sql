-- 0028: Void / cancel a sales invoice (SALT-031).
-- Marks the bill 'cancelled', returns its stock, and posts the exact reversing
-- ledger entries (GST output reversal + sale reversal + cash/bank/party reversal)
-- so the original sale nets to zero, and records who/when/why for audit.
-- Run this in the Supabase SQL editor — the app never auto-applies migrations.
-- Depends on: sales_invoices/sale_lines (0018, live), stock_movements (0016),
-- accounting post_entry/account_id (0017). sales_invoices.status already allows
-- 'cancelled'.

-- 1. Audit columns --------------------------------------------------------
alter table public.sales_invoices add column if not exists cancelled_at  timestamptz;
alter table public.sales_invoices add column if not exists cancelled_by  uuid references auth.users (id);
alter table public.sales_invoices add column if not exists cancel_reason text;

-- 2. void_sales_invoice ---------------------------------------------------
create or replace function public.void_sales_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_shop uuid; v_party uuid; v_pay text; v_status text; v_posts boolean;
  v_taxable bigint; v_cgst bigint; v_sgst bigint; v_igst bigint; v_total bigint;
  v_pay_code text; v_line record; v_batch_id uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  select shop_id, party_id, payment_method, status, posts_effects,
         taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise
    into v_shop, v_party, v_pay, v_status, v_posts,
         v_taxable, v_cgst, v_sgst, v_igst, v_total
  from public.sales_invoices
  where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'bill not in organization'; end if;
  if v_status = 'cancelled' then raise exception 'bill is already cancelled'; end if;

  -- Only reverse effects that were actually posted. Imported opening bills
  -- (posts_effects = false) carry no stock/ledger postings, so just mark them.
  if coalesce(v_posts, true) then
    -- 2a. stock back in (best-effort: restore the batch if it still exists; always
    --     log the movement). Mirrors create_credit_note's restock.
    for v_line in
      select item_id, batch_id, batch_no, qty
      from public.sale_lines
      where invoice_id = p_invoice_id and org_id = v_org and item_id is not null and qty > 0
    loop
      v_batch_id := v_line.batch_id;
      if v_batch_id is not null then
        update public.batches set qty = qty + v_line.qty where id = v_batch_id and org_id = v_org;
      else
        update public.batches set qty = qty + v_line.qty
          where org_id = v_org and shop_id = v_shop and item_id = v_line.item_id
            and coalesce(batch_no, '') = coalesce(v_line.batch_no, '')
          returning id into v_batch_id;
      end if;
      insert into public.stock_movements (org_id, shop_id, item_id, batch_id, qty_delta, reason, ref_table, ref_id, created_by)
      values (v_org, v_shop, v_line.item_id, v_batch_id, v_line.qty, 'sale_return', 'sales_invoice', p_invoice_id, auth.uid());
    end loop;

    -- 2b. reverse the original double entry (Dr Sales + Dr GST out = Cr cash/bank/party)
    if v_pay = 'cash' then v_pay_code := 'CASH';
    elsif v_pay in ('card', 'upi', 'bank') then v_pay_code := 'BANK';
    else v_pay_code := null;  -- credit: reverse the party balance
    end if;

    if v_pay_code is not null then
      perform public.post_entry(v_org, v_shop, public.account_id(v_org, v_pay_code), null, 0, v_total, 'sales_invoice', p_invoice_id, 'Void sale');
    else
      perform public.post_entry(v_org, v_shop, null, v_party, 0, v_total, 'sales_invoice', p_invoice_id, 'Void credit sale');
    end if;
    perform public.post_entry(v_org, v_shop, public.account_id(v_org, 'SALES'),    null, v_taxable, 0, 'sales_invoice', p_invoice_id, 'Void sale');
    perform public.post_entry(v_org, v_shop, public.account_id(v_org, 'CGST_OUT'), null, v_cgst, 0, 'sales_invoice', p_invoice_id, 'Void CGST output');
    perform public.post_entry(v_org, v_shop, public.account_id(v_org, 'SGST_OUT'), null, v_sgst, 0, 'sales_invoice', p_invoice_id, 'Void SGST output');
    perform public.post_entry(v_org, v_shop, public.account_id(v_org, 'IGST_OUT'), null, v_igst, 0, 'sales_invoice', p_invoice_id, 'Void IGST output');
  end if;

  update public.sales_invoices
    set status = 'cancelled', paid_paise = 0,
        cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
  where id = p_invoice_id and org_id = v_org;
end; $$;

grant execute on function public.void_sales_invoice(uuid, text) to authenticated;
