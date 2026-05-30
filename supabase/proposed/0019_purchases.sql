-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0019: Purchase documents — POs and GRNs on the shared backbone.
-- Replaces the purchase branch of orders/place_order. receive_purchase (a GRN)
-- upserts batches (qty + free goods into stock, refreshes ptr/mrp/expiry), logs a
-- 'purchase' stock movement (0016), and posts: Dr Purchase + Dr GST input (ITC) =
-- Cr vendor (or Cr cash/bank if paid). Purchase invoices are tax-EXCLUSIVE (GST on
-- top of PTR), unlike MRP-inclusive sales.
-- Depends on: shops (0014), stock_movements (0016), accounting (0017), ledgers (0007).
-- Run after 0018.
-- FOLLOW-UP: merge_ledgers (0009) must re-point purchases/ledger_entries before
-- deleting a merged vendor (vendor_id is RESTRICT here, by design).

-- 1. purchase_orders + po_lines (optional pre-GRN) -----------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  po_no text,
  po_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'received', 'closed', 'cancelled')),
  expected_date date,
  total_paise bigint not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index purchase_orders_org_idx on public.purchase_orders (org_id);
create index purchase_orders_vendor_idx on public.purchase_orders (vendor_id);

create table public.po_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  qty integer not null default 0,
  ptr_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  line_total_paise bigint not null default 0
);
create index po_lines_po_idx on public.po_lines (po_id);

alter table public.purchase_orders enable row level security;
alter table public.po_lines        enable row level security;
create policy "purchase_orders read"   on public.purchase_orders for select using (public.is_member(org_id));
create policy "purchase_orders insert" on public.purchase_orders for insert with check (public.is_member(org_id));
create policy "purchase_orders update" on public.purchase_orders for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_orders delete" on public.purchase_orders for delete using (public.is_member(org_id));
create policy "po_lines read"   on public.po_lines for select using (public.is_member(org_id));
create policy "po_lines insert" on public.po_lines for insert with check (public.is_member(org_id));
create policy "po_lines update" on public.po_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "po_lines delete" on public.po_lines for delete using (public.is_member(org_id));

-- 2. purchases (GRN) + purchase_lines ------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  vendor_id uuid not null references public.ledgers (id) on delete restrict,
  po_id uuid references public.purchase_orders (id) on delete set null,
  grn_no text,
  vendor_invoice_no text,
  vendor_invoice_date date,
  received_date date not null default current_date,
  is_interstate boolean not null default false,
  subtotal_paise bigint not null default 0,   -- sum of line taxable
  discount_paise bigint not null default 0,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  status text not null default 'received' check (status in ('draft', 'received', 'cancelled')),
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index purchases_org_created_idx on public.purchases (org_id, created_at desc);
create index purchases_shop_idx on public.purchases (shop_id, received_date);
create index purchases_vendor_idx on public.purchases (vendor_id);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  po_line_id uuid references public.po_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  free_qty integer not null default 0,        -- scheme goods (e.g. 10+1)
  ptr_paise bigint not null default 0,        -- cost per unit (tax-exclusive)
  mrp_paise bigint not null default 0,
  discount_type text,
  discount_value numeric not null default 0,
  scheme_text text,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0  -- taxable + tax
);
create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id);
create index purchase_lines_org_idx on public.purchase_lines (org_id);

alter table public.purchases      enable row level security;
alter table public.purchase_lines enable row level security;
create policy "purchases read"   on public.purchases for select using (public.is_member(org_id));
create policy "purchases insert" on public.purchases for insert with check (public.is_member(org_id));
create policy "purchases update" on public.purchases for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchases delete" on public.purchases for delete using (public.is_member(org_id));
create policy "purchase_lines read"   on public.purchase_lines for select using (public.is_member(org_id));
create policy "purchase_lines insert" on public.purchase_lines for insert with check (public.is_member(org_id));
create policy "purchase_lines update" on public.purchase_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_lines delete" on public.purchase_lines for delete using (public.is_member(org_id));

-- 3. receive_purchase (GRN) ----------------------------------------------
-- p_lines: [{item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, mrp_paise,
--            discount_type, discount_value, gst_rate, taxable_paise, scheme_text}]
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

grant execute on function public.receive_purchase(uuid, uuid, text, date, text, integer, jsonb, uuid, text, text) to authenticated;

-- 4. Cutover migration (run once at cutover; see 0018 note on history/postings).
insert into public.purchases (
  id, org_id, shop_id, vendor_id, grn_no, received_date, status,
  subtotal_paise, taxable_paise, total_paise, paid_paise, notes, created_at)
select o.id, o.org_id, o.shop_id, o.party_id, o.order_no, o.order_date, 'received',
  o.total_paise, o.total_paise, o.total_paise, o.paid_paise, o.notes, o.created_at
from public.orders o
where o.direction = 'purchase' and o.party_id is not null
on conflict (id) do nothing;

insert into public.purchase_lines (
  id, org_id, purchase_id, item_id, name, batch_no, expiry, qty, ptr_paise,
  discount_type, discount_value, taxable_paise, gst_rate, line_total_paise)
select ol.id, ol.org_id, ol.order_id, ol.item_id, ol.name, ol.batch_no, ol.expiry, ol.qty, ol.rate_paise,
  ol.discount_type, ol.discount_value, ol.line_total_paise, ol.gst_rate, ol.line_total_paise
from public.order_lines ol
join public.orders o on o.id = ol.order_id and o.direction = 'purchase' and o.party_id is not null
on conflict (id) do nothing;
