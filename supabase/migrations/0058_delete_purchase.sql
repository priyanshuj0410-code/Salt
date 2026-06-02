-- 0058: delete_purchase — fully reverse + remove a GRN (purchase). Deleting a bad
-- scanned / imported GRN should undo everything it did — stock, vendor payable, and
-- ITC — and remove the records, so the scan-history Delete can clean up wrong uploads
-- (e.g. the early PTR/PTS misreads). Owner-only, SECURITY DEFINER. Run in the SQL editor.
--
-- Stock is allowed to go NEGATIVE on purpose: if a deleted GRN's stock had already
-- been sold, the on-hand goes below zero, which is a deliberate signal that the
-- correct purchase invoice is missing and needs re-entering. No floor, no blocking.
--
-- Reversal map (mirrors what receive_purchase wrote, 0019/0046):
--   batches.qty       -= (qty + free_qty) per line   [no guard → may go negative]
--   stock_movements    delete where ref_table='purchase', ref_id=<grn>   [polymorphic, no FK]
--   ledger_entries     delete where ref_table='purchase', ref_id=<grn>   [payable + ITC + purchase]
--   purchases          delete → purchase_lines CASCADE; debit_notes.purchase_id +
--                      invoice_scans.purchase_id set null by their FKs
--   purchase_orders    a PO received against reverts to 'sent'

create or replace function public.delete_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_shop uuid;
  v_po uuid;
  v_line record;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not public.has_role(v_org, 'owner') then raise exception 'deleting a GRN is owner-only'; end if;

  select shop_id, po_id into v_shop, v_po from public.purchases where id = p_purchase_id and org_id = v_org;
  if not found then raise exception 'GRN not in this organization'; end if;

  -- 1. Reverse the stock each line added (received qty + free goods). No floor — a
  --    negative on-hand is the intended "purchase invoice missing" signal.
  for v_line in
    select item_id, batch_no, qty, coalesce(free_qty, 0) as free_qty
    from public.purchase_lines
    where purchase_id = p_purchase_id and item_id is not null
  loop
    update public.batches
      set qty = qty - (v_line.qty + v_line.free_qty)
      where org_id = v_org and shop_id = v_shop and item_id = v_line.item_id
        and coalesce(batch_no, '') = coalesce(v_line.batch_no, '');
  end loop;

  -- 2. Remove the polymorphic traces (no FK cascade for these two).
  delete from public.ledger_entries where org_id = v_org and ref_table = 'purchase' and ref_id = p_purchase_id;
  delete from public.stock_movements where org_id = v_org and ref_table = 'purchase' and ref_id = p_purchase_id;

  -- 3. Delete the GRN. purchase_lines cascade; debit_notes / invoice_scans links null out.
  delete from public.purchases where id = p_purchase_id and org_id = v_org;

  -- 4. Let a PO this GRN received against be received again.
  if v_po is not null then
    update public.purchase_orders set status = 'sent'
      where id = v_po and org_id = v_org and status = 'received';
  end if;
end; $$;

grant execute on function public.delete_purchase(uuid) to authenticated;
