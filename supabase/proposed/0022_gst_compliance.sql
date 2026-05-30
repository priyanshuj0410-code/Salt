-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0022: GST & compliance.
-- Filing periods + GSTR-2B reconciliation + the Schedule H1/X register + drug
-- licenses. GSTR-1/3B/ITC are VIEWS derived from the document tables and the
-- ledger, not stored. Views use security_invoker so per-org RLS still applies.
-- Depends on: sales (0018), purchases (0019), returns (0020), items (0004). Run after 0021.

-- 1. gst_returns: a filing period's lock/status --------------------------
create table public.gst_returns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,  -- null = org-consolidated
  period text not null,                              -- 'YYYY-MM'
  return_type text not null check (return_type in ('GSTR1', 'GSTR3B')),
  status text not null default 'draft' check (status in ('draft', 'filed')),
  filed_at timestamptz,
  summary jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (org_id, shop_id, period, return_type)
);
create index gst_returns_org_idx on public.gst_returns (org_id, period);

-- 2. GSTR-2B import + reconciliation against purchases -------------------
create table public.gstr2b_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  period text not null,
  filename text,
  imported_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);
create table public.gstr2b_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  import_id uuid not null references public.gstr2b_imports (id) on delete cascade,
  vendor_gstin text,
  invoice_no text,
  invoice_date date,
  taxable_paise bigint not null default 0,
  cgst_paise bigint not null default 0,
  sgst_paise bigint not null default 0,
  igst_paise bigint not null default 0
);
create table public.gstr2b_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  gstr2b_line_id uuid not null references public.gstr2b_lines (id) on delete cascade,
  purchase_id uuid references public.purchases (id) on delete set null,
  match_status text not null check (match_status in ('matched', 'mismatch', 'missing_in_books', 'missing_in_2b')),
  variance_paise bigint not null default 0,
  created_at timestamptz not null default now()
);
create index gstr2b_lines_import_idx on public.gstr2b_lines (import_id);
create index gstr2b_matches_line_idx on public.gstr2b_matches (gstr2b_line_id);

-- 3. h1_register: Schedule H1/X dispensing log --------------------------
create table public.h1_register (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  sale_invoice_id uuid references public.sales_invoices (id) on delete set null,
  sale_line_id uuid references public.sale_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  drug_name text not null,
  schedule text not null check (schedule in ('H', 'H1', 'X')),
  batch_no text,
  expiry text,
  qty integer not null default 0,
  doctor_name text,
  doctor_reg_no text,
  patient_name text,
  patient_address text,
  pharmacist_id uuid references auth.users (id),
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index h1_register_org_idx on public.h1_register (org_id, sold_at desc);
create index h1_register_invoice_idx on public.h1_register (sale_invoice_id);

-- 4. drug_licenses: store licenses + renewal tracking -------------------
create table public.drug_licenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  license_type text not null,                        -- '20' | '21' | '20B' | '21B' | 'Form 20F' ...
  license_no text not null,
  holder_name text,
  issued_date date,
  expiry_date date,
  notes text,
  created_at timestamptz not null default now()
);
create index drug_licenses_org_idx on public.drug_licenses (org_id);
create index drug_licenses_expiry_idx on public.drug_licenses (expiry_date);

-- RLS for all compliance tables -----------------------------------------
alter table public.gst_returns    enable row level security;
alter table public.gstr2b_imports enable row level security;
alter table public.gstr2b_lines   enable row level security;
alter table public.gstr2b_matches enable row level security;
alter table public.h1_register    enable row level security;
alter table public.drug_licenses  enable row level security;
create policy "gst_returns read"   on public.gst_returns for select using (public.is_member(org_id));
create policy "gst_returns insert" on public.gst_returns for insert with check (public.is_member(org_id));
create policy "gst_returns update" on public.gst_returns for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gst_returns delete" on public.gst_returns for delete using (public.is_member(org_id));
create policy "gstr2b_imports read"   on public.gstr2b_imports for select using (public.is_member(org_id));
create policy "gstr2b_imports insert" on public.gstr2b_imports for insert with check (public.is_member(org_id));
create policy "gstr2b_imports update" on public.gstr2b_imports for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_imports delete" on public.gstr2b_imports for delete using (public.is_member(org_id));
create policy "gstr2b_lines read"   on public.gstr2b_lines for select using (public.is_member(org_id));
create policy "gstr2b_lines insert" on public.gstr2b_lines for insert with check (public.is_member(org_id));
create policy "gstr2b_lines update" on public.gstr2b_lines for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_lines delete" on public.gstr2b_lines for delete using (public.is_member(org_id));
create policy "gstr2b_matches read"   on public.gstr2b_matches for select using (public.is_member(org_id));
create policy "gstr2b_matches insert" on public.gstr2b_matches for insert with check (public.is_member(org_id));
create policy "gstr2b_matches update" on public.gstr2b_matches for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "gstr2b_matches delete" on public.gstr2b_matches for delete using (public.is_member(org_id));
create policy "h1_register read"   on public.h1_register for select using (public.is_member(org_id));
create policy "h1_register insert" on public.h1_register for insert with check (public.is_member(org_id));
create policy "h1_register update" on public.h1_register for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "h1_register delete" on public.h1_register for delete using (public.is_member(org_id));
create policy "drug_licenses read"   on public.drug_licenses for select using (public.is_member(org_id));
create policy "drug_licenses insert" on public.drug_licenses for insert with check (public.is_member(org_id));
create policy "drug_licenses update" on public.drug_licenses for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "drug_licenses delete" on public.drug_licenses for delete using (public.is_member(org_id));

-- 5. Schedule H1/X hard gate --------------------------------------------
-- record_h1_entry logs a dispensing; enforce_h1_gate fails an invoice that sold
-- a H1/X item without a complete register entry (doctor + patient details).
create or replace function public.record_h1_entry(
  p_shop_id uuid, p_sale_invoice_id uuid, p_sale_line_id uuid, p_item_id uuid,
  p_drug_name text, p_schedule text, p_batch_no text, p_expiry text, p_qty integer,
  p_doctor_name text, p_doctor_reg_no text, p_patient_name text, p_patient_address text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if p_schedule in ('H1', 'X') and (coalesce(p_doctor_name, '') = '' or coalesce(p_patient_name, '') = '' or coalesce(p_patient_address, '') = '') then
    raise exception 'Schedule % requires doctor name, patient name and address', p_schedule;
  end if;
  insert into public.h1_register (
    org_id, shop_id, sale_invoice_id, sale_line_id, item_id, drug_name, schedule,
    batch_no, expiry, qty, doctor_name, doctor_reg_no, patient_name, patient_address, pharmacist_id)
  values (v_org, p_shop_id, p_sale_invoice_id, p_sale_line_id, p_item_id, p_drug_name, p_schedule,
    p_batch_no, p_expiry, p_qty, p_doctor_name, p_doctor_reg_no, p_patient_name, p_patient_address, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.record_h1_entry(uuid, uuid, uuid, uuid, text, text, text, text, integer, text, text, text, text) to authenticated;

-- Raises if any H1/X line on the invoice lacks a register entry. Wire into
-- create_sales_invoice (0018) by adding `perform public.enforce_h1_gate(v_inv);`
-- just before `return v_inv;` (and pass patient details via record_h1_entry in
-- the same transaction). Kept as a separate function to avoid duplicating the
-- whole 0018 RPC body in this draft.
create or replace function public.enforce_h1_gate(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.sale_lines sl
    join public.items i on i.id = sl.item_id
    where sl.invoice_id = p_invoice and i.schedule in ('H1', 'X')
      and not exists (select 1 from public.h1_register h where h.sale_line_id = sl.id)
  ) then
    raise exception 'Schedule H1/X items on this invoice need a completed H1 register entry';
  end if;
end; $$;

-- 6. Derived GST views (starting points; refine column mapping at build time) ---
create view public.v_gstr1_b2b with (security_invoker = true) as
  select si.org_id, to_char(si.invoice_date, 'YYYY-MM') as period,
    l.gstin as party_gstin, l.name as party_name,
    sum(si.taxable_paise) as taxable_paise, sum(si.cgst_paise) as cgst_paise,
    sum(si.sgst_paise) as sgst_paise, sum(si.igst_paise) as igst_paise, sum(si.total_paise) as total_paise
  from public.sales_invoices si join public.ledgers l on l.id = si.party_id
  where l.gstin is not null and si.status = 'placed'
  group by si.org_id, to_char(si.invoice_date, 'YYYY-MM'), l.gstin, l.name;

create view public.v_gstr1_b2c with (security_invoker = true) as
  select si.org_id, to_char(si.invoice_date, 'YYYY-MM') as period, si.is_interstate,
    sum(si.taxable_paise) as taxable_paise, sum(si.cgst_paise) as cgst_paise,
    sum(si.sgst_paise) as sgst_paise, sum(si.igst_paise) as igst_paise, sum(si.total_paise) as total_paise
  from public.sales_invoices si
  left join public.ledgers l on l.id = si.party_id
  where (si.party_id is null or l.gstin is null) and si.status = 'placed'
  group by si.org_id, to_char(si.invoice_date, 'YYYY-MM'), si.is_interstate;

create view public.v_gstr1_hsn with (security_invoker = true) as
  select sl.org_id, to_char(si.invoice_date, 'YYYY-MM') as period,
    i.hsn, sl.gst_rate,
    sum(sl.qty) as qty, sum(sl.taxable_paise) as taxable_paise,
    sum(sl.cgst_paise) as cgst_paise, sum(sl.sgst_paise) as sgst_paise, sum(sl.igst_paise) as igst_paise
  from public.sale_lines sl
  join public.sales_invoices si on si.id = sl.invoice_id
  left join public.items i on i.id = sl.item_id
  where si.status = 'placed'
  group by sl.org_id, to_char(si.invoice_date, 'YYYY-MM'), i.hsn, sl.gst_rate;

create view public.v_itc_register with (security_invoker = true) as
  select p.org_id, to_char(p.received_date, 'YYYY-MM') as period,
    sum(p.cgst_paise) as cgst_in_paise, sum(p.sgst_paise) as sgst_in_paise, sum(p.igst_paise) as igst_in_paise
  from public.purchases p where p.status = 'received'
  group by p.org_id, to_char(p.received_date, 'YYYY-MM');

create view public.v_gstr3b_summary with (security_invoker = true) as
  select org_id, period,
    sum(out_taxable) as outward_taxable_paise, sum(out_cgst) as out_cgst_paise,
    sum(out_sgst) as out_sgst_paise, sum(out_igst) as out_igst_paise,
    sum(in_cgst) as itc_cgst_paise, sum(in_sgst) as itc_sgst_paise, sum(in_igst) as itc_igst_paise
  from (
    select org_id, to_char(invoice_date, 'YYYY-MM') as period,
      taxable_paise as out_taxable, cgst_paise as out_cgst, sgst_paise as out_sgst, igst_paise as out_igst,
      0::bigint as in_cgst, 0::bigint as in_sgst, 0::bigint as in_igst
    from public.sales_invoices where status = 'placed'
    union all
    select org_id, to_char(received_date, 'YYYY-MM') as period,
      0, 0, 0, 0, cgst_paise, sgst_paise, igst_paise
    from public.purchases where status = 'received'
  ) u
  group by org_id, period;
