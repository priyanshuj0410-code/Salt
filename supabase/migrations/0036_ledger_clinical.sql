-- 0036: clinical profile on ledgers (SALT-163).
-- Additive, nullable storage so a chemist can track a customer's chronic
-- conditions, allergies, and regular medicines (drives refill reminders +
-- dispensing safety). Unblocks parties SALT-052. No backfill, no policy change.
--
-- One jsonb column holds the lot, easy to extend:
--   { chronic_conditions: text[], allergies: text[],
--     regular_meds: [{ name, dose, freq }] }
--
-- SENSITIVE PII (health data). ledgers already gates every op on
-- is_member(org_id) (migration 0007), so this inherits strict per-org RLS — no
-- policy change. Per the PRD NFRs (no plaintext-PII logs; GDPR export/delete):
-- do NOT log row contents, and include this column in any party export/delete
-- tooling. Run after 0035.

alter table public.ledgers
  add column if not exists clinical jsonb not null default '{}'::jsonb;
