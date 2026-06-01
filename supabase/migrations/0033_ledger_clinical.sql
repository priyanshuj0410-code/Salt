-- 0033: clinical jsonb on ledgers — a customer's chronic conditions, allergies
-- and regular medicines, for refill reminders and safer dispensing (SALT-052).
-- Shape: { conditions?: text, allergies?: text, regular_meds?: text }.
-- Sensitive PII (health data): RLS on ledgers (0007, is_member(org_id)) keeps it
-- org-scoped — do NOT log its contents, and include it in GDPR export/delete.
-- Additive, default '{}'. Run after 0008. Closes SALT-163.

alter table public.ledgers add column if not exists clinical jsonb not null default '{}'::jsonb;
