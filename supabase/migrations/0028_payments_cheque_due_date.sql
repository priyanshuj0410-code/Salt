-- 0028: post-dated cheque support (SALT-060).
-- Adds a clearance/due date to cheque payments so the Payments module can track
-- post-dated cheques (PDCs): upcoming due dates plus a pending -> cleared/bounced
-- lifecycle. `payments.status` ('pending' | 'cleared' | 'bounced') already exists
-- (0021); this only adds the date. Idempotent — safe to re-run.
alter table public.payments add column if not exists cheque_due_date date;

comment on column public.payments.cheque_due_date is
  'For mode=cheque: the date the cheque is dated / expected to clear. Drives post-dated cheque management (SALT-060).';
