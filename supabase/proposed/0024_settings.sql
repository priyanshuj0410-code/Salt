-- DRAFT / DESIGN ONLY — DO NOT RUN. Promote to supabase/migrations/ when building this slice.
-- 0024: Settings + forward hooks.
-- Invoice numbering per shop/series, print templates, org/shop settings, salesmen,
-- and thin Tier-4 stub tables (ABHA patients, purchase-OCR, ONDC, B2B) so those
-- features never force a core rewrite. The stubs are intentionally minimal and
-- NOT wired to anything in v1.
-- Depends on: shops (0014), sales_invoices (0018). Run after 0023.

-- 1. invoice_series + next_doc_no ----------------------------------------
create table public.invoice_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  doc_type text not null check (doc_type in ('sales_invoice', 'purchase', 'credit_note', 'debit_note', 'payment')),
  prefix text,
  next_number integer not null default 1,
  financial_year text not null,                     -- '2025-26'
  unique (org_id, shop_id, doc_type, financial_year)
);
create index invoice_series_org_idx on public.invoice_series (org_id);

-- Atomically allocate the next number for a (shop, doc_type) in the current FY.
create or replace function public.next_doc_no(p_shop uuid, p_doc_type text)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_prefix text; v_num integer; v_fy text; v_yr integer;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  v_yr := extract(year from current_date)::integer;
  -- Indian FY runs Apr-Mar.
  if extract(month from current_date) >= 4 then
    v_fy := v_yr || '-' || lpad(((v_yr + 1) % 100)::text, 2, '0');
  else
    v_fy := (v_yr - 1) || '-' || lpad((v_yr % 100)::text, 2, '0');
  end if;
  update public.invoice_series set next_number = next_number + 1
    where org_id = v_org and shop_id = p_shop and doc_type = p_doc_type and financial_year = v_fy
    returning prefix, next_number - 1 into v_prefix, v_num;
  if not found then
    insert into public.invoice_series (org_id, shop_id, doc_type, prefix, next_number, financial_year)
    values (v_org, p_shop, p_doc_type, upper(left(p_doc_type, 3)), 2, v_fy)
    returning prefix, 1 into v_prefix, v_num;
  end if;
  return coalesce(v_prefix, '') || '/' || v_fy || '/' || lpad(v_num::text, 5, '0');
end; $$;
grant execute on function public.next_doc_no(uuid, text) to authenticated;

-- 2. print_templates -----------------------------------------------------
create table public.print_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  doc_type text not null,
  name text not null,
  format text not null default 'a4' check (format in ('thermal', 'a4', 'dotmatrix')),
  template jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index print_templates_org_idx on public.print_templates (org_id);

-- 3. org_settings / shop_settings (one jsonb blob per scope) -------------
create table public.org_settings (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.shop_settings (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 4. salesmen (wholesale) ------------------------------------------------
create table public.salesmen (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  phone text,
  territory text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index salesmen_org_idx on public.salesmen (org_id);
alter table public.sales_invoices add column salesman_id uuid references public.salesmen (id) on delete set null;

-- 5. Tier-4 forward hooks (thin; not wired in v1) ------------------------
create table public.patients (                       -- ABHA / ABDM linkage
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  phone text,
  abha_id text,
  address text,
  created_at timestamptz not null default now()
);
create table public.purchase_ocr_jobs (             -- AI purchase-invoice capture
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  file_url text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  extracted jsonb,
  created_at timestamptz not null default now()
);
create table public.ondc_listings (                 -- ONDC catalogue publish
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  item_id uuid references public.items (id) on delete cascade,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
create table public.b2b_connections (               -- ERP-to-ERP ordering
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  partner_org_id uuid,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- RLS for every table in this file --------------------------------------
alter table public.invoice_series   enable row level security;
alter table public.print_templates  enable row level security;
alter table public.org_settings     enable row level security;
alter table public.shop_settings    enable row level security;
alter table public.salesmen         enable row level security;
alter table public.patients         enable row level security;
alter table public.purchase_ocr_jobs enable row level security;
alter table public.ondc_listings    enable row level security;
alter table public.b2b_connections  enable row level security;

create policy "invoice_series read"   on public.invoice_series for select using (public.is_member(org_id));
create policy "invoice_series insert" on public.invoice_series for insert with check (public.is_member(org_id));
create policy "invoice_series update" on public.invoice_series for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "invoice_series delete" on public.invoice_series for delete using (public.is_member(org_id));
create policy "print_templates read"   on public.print_templates for select using (public.is_member(org_id));
create policy "print_templates insert" on public.print_templates for insert with check (public.is_member(org_id));
create policy "print_templates update" on public.print_templates for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "print_templates delete" on public.print_templates for delete using (public.is_member(org_id));
create policy "org_settings read"   on public.org_settings for select using (public.is_member(org_id));
create policy "org_settings insert" on public.org_settings for insert with check (public.is_member(org_id));
create policy "org_settings update" on public.org_settings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org_settings delete" on public.org_settings for delete using (public.is_member(org_id));
create policy "shop_settings read"   on public.shop_settings for select using (public.is_member(org_id));
create policy "shop_settings insert" on public.shop_settings for insert with check (public.is_member(org_id));
create policy "shop_settings update" on public.shop_settings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "shop_settings delete" on public.shop_settings for delete using (public.is_member(org_id));
create policy "salesmen read"   on public.salesmen for select using (public.is_member(org_id));
create policy "salesmen insert" on public.salesmen for insert with check (public.is_member(org_id));
create policy "salesmen update" on public.salesmen for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "salesmen delete" on public.salesmen for delete using (public.is_member(org_id));
create policy "patients read"   on public.patients for select using (public.is_member(org_id));
create policy "patients insert" on public.patients for insert with check (public.is_member(org_id));
create policy "patients update" on public.patients for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "patients delete" on public.patients for delete using (public.is_member(org_id));
create policy "purchase_ocr_jobs read"   on public.purchase_ocr_jobs for select using (public.is_member(org_id));
create policy "purchase_ocr_jobs insert" on public.purchase_ocr_jobs for insert with check (public.is_member(org_id));
create policy "purchase_ocr_jobs update" on public.purchase_ocr_jobs for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "purchase_ocr_jobs delete" on public.purchase_ocr_jobs for delete using (public.is_member(org_id));
create policy "ondc_listings read"   on public.ondc_listings for select using (public.is_member(org_id));
create policy "ondc_listings insert" on public.ondc_listings for insert with check (public.is_member(org_id));
create policy "ondc_listings update" on public.ondc_listings for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "ondc_listings delete" on public.ondc_listings for delete using (public.is_member(org_id));
create policy "b2b_connections read"   on public.b2b_connections for select using (public.is_member(org_id));
create policy "b2b_connections insert" on public.b2b_connections for insert with check (public.is_member(org_id));
create policy "b2b_connections update" on public.b2b_connections for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "b2b_connections delete" on public.b2b_connections for delete using (public.is_member(org_id));
