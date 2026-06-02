-- 0061: invoice_scans.invoice_no — make the import queue dedup-aware across channels.
--
-- Every invoice import (OCR PDF/image AND CSV) now writes an invoice_scans row, so a
-- duplicate bill can be caught against the in-flight queue — not only against posted
-- GRNs (purchases.vendor_invoice_no). To match the queue with an indexed lookup instead
-- of scanning the extracted_json blob, denormalise the invoice number into its own
-- column. Populated going forward by the client (insertExtractedScan / the OCR review
-- path) and by the process-scans worker. Run in the Supabase SQL editor after 0060.

alter table public.invoice_scans add column if not exists invoice_no text;

create index if not exists invoice_scans_invoice_no_idx
  on public.invoice_scans (org_id, invoice_no);

-- Backfill existing rows from the stored extraction.
update public.invoice_scans
  set invoice_no = nullif(trim(extracted_json->>'invoice_no'), '')
  where invoice_no is null and extracted_json is not null;
