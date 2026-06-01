-- 0049: Invoice-scan audit + retry (SALT-221). Persist every OCR-scanned invoice
-- (SALT-027) so scans are auditable and failed extractions retry from the stored
-- file instead of a re-upload. Two parts: a private Storage bucket for the files,
-- and an invoice_scans table tracking each scan's lifecycle. Run in the Supabase
-- SQL editor. Storage tables (storage.buckets / storage.objects) already exist on
-- every project; we only insert a bucket row + add per-object RLS policies.

-- 1. Private bucket for the uploaded invoice files ---------------------------
-- Files are keyed `{org_id}/{scan_id}.{ext}`; the first path segment is the org,
-- which the policies below gate on. Not public — reads go through signed URLs.
insert into storage.buckets (id, name, public)
values ('invoice-scans', 'invoice-scans', false)
on conflict (id) do nothing;

-- Per-object RLS on storage.objects, scoped to this bucket. A user may touch an
-- object only when its first path segment (the org id) is an org they belong to.
-- (storage.foldername(name) splits the object key on '/'; [1] is the first folder.)
create policy "invoice-scans read"
  on storage.objects for select
  using (bucket_id = 'invoice-scans' and public.is_member((storage.foldername(name))[1]::uuid));

create policy "invoice-scans insert"
  on storage.objects for insert
  with check (bucket_id = 'invoice-scans' and public.is_member((storage.foldername(name))[1]::uuid));

create policy "invoice-scans update"
  on storage.objects for update
  using (bucket_id = 'invoice-scans' and public.is_member((storage.foldername(name))[1]::uuid));

create policy "invoice-scans delete"
  on storage.objects for delete
  using (bucket_id = 'invoice-scans' and public.is_member((storage.foldername(name))[1]::uuid));

-- 2. The scan audit record ---------------------------------------------------
create table public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete set null,
  -- The object key in the invoice-scans bucket: `{org_id}/{id}.{ext}`.
  storage_path text not null,
  original_filename text,
  mime text,
  -- Lifecycle: uploaded → extracted (OCR ok) | failed (OCR error) → posted (GRN created).
  status text not null default 'pending' check (status in ('pending', 'extracted', 'failed', 'posted')),
  -- The model's structured output, kept verbatim for audit + retry without re-calling OCR.
  extracted_json jsonb,
  -- Best-effort vendor name from extraction, for a readable history row before posting.
  vendor_guess text,
  -- The function's error message when status = 'failed'.
  error text,
  -- The GRN this scan was posted as, once posted.
  purchase_id uuid references public.purchases (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_scans_org_idx on public.invoice_scans (org_id);
create index invoice_scans_status_idx on public.invoice_scans (org_id, status);

alter table public.invoice_scans enable row level security;

-- Per-org gate, deny-by-default (mirrors items/0004).
create policy "invoice_scans read"   on public.invoice_scans for select using (public.is_member(org_id));
create policy "invoice_scans insert" on public.invoice_scans for insert with check (public.is_member(org_id));
create policy "invoice_scans update" on public.invoice_scans for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "invoice_scans delete" on public.invoice_scans for delete using (public.is_member(org_id));
