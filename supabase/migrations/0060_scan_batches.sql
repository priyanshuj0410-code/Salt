-- 0060: multi-file background scan extraction (feedback). Upload several invoices at
-- once; the process-scans Edge Function extracts them server-side so the user can move
-- on, then reviews + posts from scan history. Adds:
--   batch_id   — groups one multi-file upload
--   status 'processing' (worker is extracting) + 'duplicate' (invoice already posted)
-- Run in the Supabase SQL editor after 0059.

alter table public.invoice_scans add column if not exists batch_id uuid;
create index if not exists invoice_scans_batch_idx on public.invoice_scans (batch_id);

alter table public.invoice_scans drop constraint if exists invoice_scans_status_check;
alter table public.invoice_scans
  add constraint invoice_scans_status_check
  check (status in ('pending', 'processing', 'extracted', 'failed', 'posted', 'duplicate'));
