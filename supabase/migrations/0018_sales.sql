-- 0018: Sales documents — invoices on the shared backbone.
-- Replaces the sale branch of orders/place_order. create_sales_invoice is the
-- authority for the GST split (CGST+SGST intra-state vs IGST inter-state, decided
-- by shop.state_code vs party.state_code), backs MRP-inclusive tax out of the line
-- total, moves stock via stock_movements (0016), and posts balanced double entries
-- (0017): Dr cash/bank or party = Cr Sales + Cr GST output.
-- Depends on: shops (0014), stock_movements (0016), accounting (0017), ledgers (0007).
-- Run after 0017.

-- 1. sales_invoices -------------------------------------------------------
create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  party_id uuid references public.ledgers (id) on delete set null,  -- null = walk-in
  invoice_no text,
  invoice_date date not null default current_date,
  status text not null default 'placed' check (status in ('draft', 'placed', 'cancelled')),
  payment_method text,                       -- cash | card | upi | bank | credit
  credit_days integer,
  due_date date,
  is_interstate boolean not null default false,
  subtotal_paise bigint not null default 0,  -- tax-inclusive gross of all lines
  discount_paise bigint not null default 0,  -- bill-level discount (line discounts are in the lines)
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  round_off_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,
  doctor_name text,                          -- prescriber, for Schedule H/H1 sales
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index sales_invoices_org_created_idx on public.sales_invoices (org_id, created_at desc);
create index sales_invoices_shop_idx on public.sales_invoices (shop_id, invoice_date);
create index sales_invoices_party_idx on public.sales_invoices (party_id);

alter table public.sales_invoices enable row level security;
create policy "sales_invoices read"   on public.sales_invoices for select using (public.is_member(org_id));
create policy "sales_invoices insert" on public.sales_invoices for insert with check (public.is_member(org_id));
create policy "sales_invoices update" on public.sales_invoices for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "sales_invoices delete" on public.sales_invoices for delete using (public.is_member(org_id));

-- 2. sale_lines -----------------------------------------------------------
create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null references public.sales_invoices (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  batch_id uuid references public.batches (id) on delete set null,
  name text not null,
  batch_no text,
  expiry text,
  qty integer not null default 0,
  rate_paise bigint not null default 0,       -- MRP (tax-inclusive)
  discount_type text,
  discount_value numeric not null default 0,
  taxable_paise bigint not null default 0,
  gst_rate numeric not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0,
  line_total_paise bigint not null default 0, -- tax-inclusive, post-discount
  created_at timestamptz not null default now()
);
create index sale_lines_invoice_idx on public.sale_lines (invoice_id);
create index sale_lines_org_idx on public.sale_lines (org_id);

alter table public.sale_lines enable row level security;
create policy "sale_lines read"   on public.sale_lines for select using (public.is_member(org_id));
create policy "sale_lines insert" on public.sale_lines for insert with check (public.is_member(org_id));
create policy "sale_lines update" on public.sale_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "sale_lines delete" on public.sale_lines for delete using (public.is_member(org_id));

-- 3. create_sales_invoice -------------------------------------------------
-- p_lines: [{item_id, batch_id, name, batch_no, expiry, qty, rate_paise,
--            discount_type, discount_value, gst_rate, line_total_paise}]
-- NOTE: the Schedule H1/X hard gate (require doctor + patient details) is wired
-- in 0022 once h1_register exists; this RPC already carries doctor_name.
create or replace function public.create_sales_invoice(
  p_shop_id uuid,
  p_party_id uuid,
  p_payment_method text,
  p_credit_days integer,
  p_lines jsonb,
  p_invoice_no text default null,
  p_doctor_name text default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_inv uuid;
  v_intra boolean; v_shop_state text; v_party_state text;
  v_line jsonb;
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

  insert into public.sales_invoices (
    org_id, shop_id, party_id, invoice_no, status, payment_method, credit_days,
    is_interstate, doctor_name, notes, created_by
  ) values (
    v_org, p_shop_id, p_party_id, p_invoice_no, 'placed', p_payment_method, p_credit_days,
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
    );

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

  return v_inv;
end; $$;

grant execute on function public.create_sales_invoice(uuid, uuid, text, integer, jsonb, text, text, text) to authenticated;

-- 4. Cutover migration (run once, after the app switches to create_sales_invoice).
-- Copies sale history out of the unified orders table, preserving ids so /bills
-- links survive. Stock and ledgers are NOT re-posted here — batches.qty and party
-- balances already reflect these sales; historical postings are seeded separately
-- as opening stock_movements + balanced opening ledger_entries at cutover (see
-- wiki/decisions/0009). orders is dropped only after 0019 also migrates purchases.
insert into public.sales_invoices (
  id, org_id, shop_id, party_id, invoice_no, invoice_date, status, payment_method,
  credit_days, due_date, subtotal_paise, taxable_paise, total_paise, paid_paise, notes, created_at)
select o.id, o.org_id, o.shop_id, o.party_id, o.order_no, o.order_date, 'placed', o.payment_method,
  o.credit_days, o.due_date, o.total_paise, o.total_paise, o.total_paise, o.paid_paise, o.notes, o.created_at
from public.orders o where o.direction = 'sale'
on conflict (id) do nothing;

insert into public.sale_lines (
  id, org_id, invoice_id, item_id, name, batch_no, expiry, qty, rate_paise,
  discount_type, discount_value, taxable_paise, gst_rate, line_total_paise, created_at)
select ol.id, ol.org_id, ol.order_id, ol.item_id, ol.name, ol.batch_no, ol.expiry, ol.qty, ol.rate_paise,
  ol.discount_type, ol.discount_value, ol.line_total_paise, ol.gst_rate, ol.line_total_paise, ol.created_at
from public.order_lines ol
join public.orders o on o.id = ol.order_id and o.direction = 'sale'
on conflict (id) do nothing;
