-- 0020: Returns & notes.
--   credit_notes = sales return: stock back in, reverse Sales + GST output, Cr party/cash.
--   debit_notes  = purchase/expiry return to vendor: stock out, reverse Purchase +
--                  GST input (ITC reversal), Dr vendor.
-- Both reuse the GST-split + double-entry pattern of 0018/0019, reversed.
-- Depends on: sales (0018), purchases (0019), accounting (0017). Run after 0019.

-- 1. credit_notes (sales return) -----------------------------------------
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null,
  sale_invoice_id uuid references public.sales_invoices (id) on delete set null,
  note_no text,
  note_date date not null default current_date,
  reason text,
  is_interstate boolean not null default false,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  total_paise bigint not null default 0,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index credit_notes_org_idx on public.credit_notes (org_id, created_at desc);
create index credit_notes_party_idx on public.credit_notes (party_id);

create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes (id) on delete cascade,
  sale_line_id uuid references public.sale_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  rate_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0
);
create index credit_note_lines_note_idx on public.credit_note_lines (credit_note_id);

-- 2. debit_notes (purchase / expiry return) ------------------------------
create table public.debit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  purchase_id uuid references public.purchases (id) on delete set null,
  note_no text,
  note_date date not null default current_date,
  reason text,
  is_interstate boolean not null default false,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  itc_reversal_paise bigint not null default 0,
  total_paise bigint not null default 0,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index debit_notes_org_idx on public.debit_notes (org_id, created_at desc);
create index debit_notes_vendor_idx on public.debit_notes (vendor_id);

create table public.debit_note_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  debit_note_id uuid not null references public.debit_notes (id) on delete cascade,
  purchase_line_id uuid references public.purchase_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  ptr_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0
);
create index debit_note_lines_note_idx on public.debit_note_lines (debit_note_id);

-- RLS for all four tables (standard per-org gate) ------------------------
alter table public.credit_notes      enable row level security;
alter table public.credit_note_lines enable row level security;
alter table public.debit_notes       enable row level security;
alter table public.debit_note_lines  enable row level security;
create policy "credit_notes read"   on public.credit_notes for select using (public.is_member(org_id));
create policy "credit_notes insert" on public.credit_notes for insert with check (public.is_member(org_id));
create policy "credit_notes update" on public.credit_notes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "credit_notes delete" on public.credit_notes for delete using (public.is_member(org_id));
create policy "credit_note_lines read"   on public.credit_note_lines for select using (public.is_member(org_id));
create policy "credit_note_lines insert" on public.credit_note_lines for insert with check (public.is_member(org_id));
create policy "credit_note_lines update" on public.credit_note_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "credit_note_lines delete" on public.credit_note_lines for delete using (public.is_member(org_id));
create policy "debit_notes read"   on public.debit_notes for select using (public.is_member(org_id));
create policy "debit_notes insert" on public.debit_notes for insert with check (public.is_member(org_id));
create policy "debit_notes update" on public.debit_notes for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "debit_notes delete" on public.debit_notes for delete using (public.is_member(org_id));
create policy "debit_note_lines read"   on public.debit_note_lines for select using (public.is_member(org_id));
create policy "debit_note_lines insert" on public.debit_note_lines for insert with check (public.is_member(org_id));
create policy "debit_note_lines update" on public.debit_note_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "debit_note_lines delete" on public.debit_note_lines for delete using (public.is_member(org_id));

-- 3. create_credit_note (sales return) -----------------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, expiry, qty, rate_paise, gst_rate, line_total_paise}]
-- p_refund_mode: 'cash' | 'bank' | 'credit' (credit = reduce the party's receivable)
create or replace function public.create_credit_note(
  p_shop_id uuid, p_party_id uuid, p_sale_invoice_id uuid, p_reason text,
  p_refund_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
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
    v_gross := coalesce((v_line->>'line_total_paise')::bigint, 0);
    v_rate := coalesce((v_line->>'gst_rate')::numeric, 0);
    v_taxable := round(v_gross * 100.0 / (100.0 + v_rate));
    v_tax := v_gross - v_taxable;
    if v_intra then v_cgst := v_tax / 2; v_sgst := v_tax - v_cgst; v_igst := 0;
    else v_cgst := 0; v_sgst := 0; v_igst := v_tax; end if;

    insert into public.credit_note_lines (
      org_id, credit_note_id, item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
      taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise, line_total_paise)
    values (v_org, v_note, v_item, v_batch_id, coalesce(v_line->>'name', ''), v_batch_no, v_line->>'expiry',
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

-- 4. create_debit_note (purchase / expiry return) ------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, qty, ptr_paise, gst_rate, taxable_paise}]
-- p_settle_mode: 'cash' | 'bank' | 'credit' (credit = reduce the vendor payable)
create or replace function public.create_debit_note(
  p_shop_id uuid, p_vendor_id uuid, p_purchase_id uuid, p_reason text,
  p_settle_mode text, p_lines jsonb, p_note_no text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_note uuid; v_intra boolean; v_shop_state text; v_vendor_state text;
  v_line jsonb; v_item uuid; v_batch_id uuid; v_batch_no text; v_qty integer;
  v_ptr bigint; v_rate numeric; v_taxable bigint; v_tax bigint; v_cgst bigint; v_sgst bigint; v_igst bigint;
  t_taxable bigint := 0; t_cgst bigint := 0; t_sgst bigint := 0; t_igst bigint := 0; t_total bigint := 0;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
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

    -- stock out (guarded)
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

  -- reverse the purchase: Dr vendor (or cash/bank) = Cr Purchase Return + Cr GST input (ITC reversal)
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

  return v_note;
end; $$;

grant execute on function public.create_debit_note(uuid, uuid, uuid, text, text, jsonb, text, text) to authenticated;
