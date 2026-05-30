---
type: decision
updated: 2026-05-31
---

# 0014 — Doctors master table

**Status:** accepted (design; pre-implementation) · **Date:** 2026-05-31

## Context

Marg Pharma maintains a **doctor / MR master** (prescribing doctors, often with registration number, specialty, contact). Selling Schedule **H / H1 / X** drugs legally requires capturing the prescriber, which is what `h1_register` holds (`doctor_name`, `doctor_reg_no` as free text); `sales_invoices.doctor_name` also captures the Rx prescriber as free text.

But there is **no `doctors` table** in the model — a Marg doctor master has nowhere structured to land, and prescriber identity is free text on every invoice / H1 entry. A structured master enables dedup, **doctor-wise sales analytics** (valuable for MR/scheme-driven wholesale), faster Rx entry (pick-from-list), and a cleaner H1 register (FK to a doctor with reg no). This is the §2-B gap flagged in [marg-import-map](../architecture/marg-import-map.md).

## Decision

**Add a `doctors` table** rather than fold prescribers into free-text only.

- `doctors` — org-scoped master, RLS-gated like every other: `id, org_id, name, reg_no, specialty, phone, address, is_active, source jsonb, created_at`.
- Add a **nullable `doctor_id` FK** on `h1_register` (and optionally `sales_invoices`) → `doctors`. Keep the existing free-text `doctor_name` / `doctor_reg_no` for ad-hoc prescribers — **FK null = free-text only**, the same walk-in pattern as `party_id` null on a sale.
- Import the Marg doctor master into `doctors`; H/H1 sale lines link when the prescriber matches, else capture free text.
- **Identity / dedup:** by **registration number when present (canonical) → normalized name (fallback)** — the same tiered-identity philosophy as GSTIN for parties ([0010](0010-gstin-canonical-party-identity.md)).

## Consequences

- **(+)** Structured prescriber master: doctor-wise analytics, faster and cleaner Rx + H1 register, dedup by reg-no.
- **(+)** Gives a real Marg master a faithful home (closes the gap); consistent with the model's *master + free-text fallback* pattern.
- **(+)** H1 compliance improves — the register can FK a verified doctor with registration number.
- **(−)** Schema change: a new table + nullable FK(s) + RLS policy (one migration).
- **(−)** Another master to maintain/merge; Marg reg-no quality is uneven → name fallback + manual merge needed (as with parties).
- **(−)** Mild scope creep vs free-text-only — justified by compliance + analytics; if a shop has no doctor master, the table simply stays empty and free text still works.

**Implementation note (pre-built):** new table + FK delivered as a migration when the importer/H1 work is built (run by the user).

See [0010](0010-gstin-canonical-party-identity.md) · [architecture/marg-import-map](../architecture/marg-import-map.md) · [domain/medical-retail](../domain/medical-retail.md)
