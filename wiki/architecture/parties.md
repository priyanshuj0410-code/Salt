---
type: architecture
updated: 2026-06-02
tags: [parties, customers, vendors, receivables, pricing]
---

# Parties module (as-built)

The **parties** module is the owner-facing CRM/ledger surface for every counterparty — customers, vendors/distributors, and control accounts. It owns `apps/web/src/components/parties/**` plus a set of `lib/` helpers, and reads/writes the `ledgers` family of tables. For the domain model (classification, merge semantics) see [../domain/parties.md](../domain/parties.md); for the underlying schema see [data-model.md](data-model.md).

A party is a row in **`ledgers`** (`type ∈ {customer, vendor, other}`). Money is integer **paise**; balances are signed **Dr `+` (receivable) / Cr `−` (payable)**.

## Screens & flows

### Parties list — `PartiesPage.tsx` (`/parties`)
The owner hub. Loads all `ledgers` + `ledger_bills` (paged past the 1000-row cap via `lib/selectAll`) and renders:
- **Summary** stat cards (counts, total receivable/payable).
- **Aging of open bills** (`AgingTable` + [`lib/aging.ts`](../../apps/web/src/lib/aging.ts)) — receivable/payable bucketed 0-30/31-60/61-90/90+ (SALT-047).
- **Upcoming vendor payments** ([`lib/cashflow.ts`](../../apps/web/src/lib/cashflow.ts)) — what you owe vendors by due date, Overdue/≤7/≤14/≤30/later, + a "next payments" list (SALT-055).
- **State-coverage nudge** — parties missing `state_code` bill as intra-state (CGST+SGST); a one-click "fill from GSTIN" backfills from the GSTIN prefix (SALT-054).
- **Merge suggestions** — `lib/mergeSuggest.ts` groups likely duplicates (same GSTIN / identical bill set / same name); confirm → `merge_ledgers` RPC (SALT domain).
- **Inline edits per row** — re-tag `type` (SALT-051) and set `customer_group` (SALT-048) without opening the profile.
- **New party** → `CreatePartyDialog`.

### Party profile — `PartyProfilePage.tsx` (`/parties/:id`)
Everything about one party:
- **Details** (editable: name, type, GSTIN, state, phone, address, credit limit).
- **Amount due** = opening balance + unsettled orders − payments. Imported docs (`posts_effects=false`) are excluded from the live due — both orders and payments (SALT-166), since the opening balance already reflects pre-cutover history.
- **Aging** of this party's open items (bills + live orders).
- **Collections actions:** _Send reminder_ (WhatsApp, [`lib/collection.ts`](../../apps/web/src/lib/collection.ts) — message + optional `upi://pay` link, SALT-053) and _Payment link_ (`PaymentLinkButton` → Razorpay link + WhatsApp share, SALT-231; see [integrations-razorpay.md](integrations-razorpay.md) / [integrations-whatsapp.md](integrations-whatsapp.md)).
- **Special pricing** (`PricingRulesSection`) — per-customer and per-group price rules + live preview (SALT-049/050; see below).
- **Clinical** (`ClinicalSection`, customers only) — chronic conditions / allergies / regular meds for refill reminders (SALT-052).
- **Internal notes** — realtime `MessageThread` keyed on the ledger (SALT-161; see [realtime.md](realtime.md)).
- Order history, payments, and imported open bills.

### Create — `CreatePartyDialog.tsx`
Hand-create a party (the path that isn't Marg import or a walk-in). Captures name/type/phone/GSTIN/state/address/credit-limit/group/opening-balance (Dr/Cr toggle); GSTIN prefix auto-fills the state; inserts straight into `ledgers` (RLS-allowed). Reusable — billing's CustomerPicker can mount it via `onCreated` (SALT-046).

## Key files
- Components: `PartiesPage`, `PartyProfilePage`, `CreatePartyDialog`, `AgingTable`, `PricingRulesSection`, `ClinicalSection`, `PaymentLinkButton`.
- Libs: `lib/aging.ts` (overdue buckets), `lib/cashflow.ts` (forward vendor buckets), `lib/collection.ts` (WhatsApp/UPI reminder), `lib/partyGroups.ts` (the 5 groups), `lib/classifyParties.ts` (heuristic type), `lib/mergeSuggest.ts` (dedupe grouping).

## Data model · migrations · RPCs
- **`ledgers`** — base `0007`; `type` enum + `opening_balance_paise` `0008`; `state_code` `0012`; `source` jsonb `0013`; **`customer_group` `0032`** (SALT-048/156); **`clinical` jsonb `0033`** (SALT-052/163). `credit_limit_paise` since `0007`. All ops gated by `is_member(org_id)` ([security-rls.md](security-rls.md)).
- **`ledger_bills`** (`0008`) — imported open invoices (ref, date, amount, `nature` dr/cr, due_date, days_overdue); the dated breakdown of the opening balance.
- **`merge_ledgers`** (`0009`) — atomically re-points bills, sums signed balances, dedupes.
- **`price_rules` + `resolve_price(party,item,shop,mrp,cost)`** (`0039`, built by the database lane as **SALT-010**) — the pricing backbone the parties UI drives; rules scope by `party_id` **or** `customer_group`, item/HSN/all, `pct_off_mrp`/`flat_price_paise`/`margin_target`, priority; resolver returns effective price + the winning rule (the "why"). See [data-model.md](data-model.md).
- **`record_payment`** RPC ([payments.md](payments.md)) and realtime **`entity_messages`** ([realtime.md](realtime.md)) are consumed but owned elsewhere.

## Decisions & gotchas
- **Defensive column probe.** Committed migrations are applied by the user lazily, so a column can be merged but not live. New-column features (`customer_group`, `clinical`, `price_rules`, `payments.posts_effects`) **try the richer query and fall back / hide** if it 42703s — the page never breaks before the migration runs. Always probe the live DB before depending on a column.
- **Sign convention** is Dr `+` / Cr `−` everywhere (balances, opening balance, aging split).
- **Imported docs excluded from live dues** (`posts_effects=false`) to avoid double-counting the opening balance (SALT-166).
- **Group pricing reuses `ledgers.customer_group`** rather than a separate `tier` column — coordinated with SALT-010.
- Classification is a heuristic defaulting to `customer`; the list is where the owner fixes mistags.

## Current state vs planned
14 parties tickets shipped (create/aging/groups/clinical/pricing/collections/re-tag/state-backfill/vendor-cashflow/message-thread/imported-payment fix/token-cleanup). **Outstanding / elsewhere:** the credit-limit **warning at the counter** (SALT-004) is billing's to render (the parties-side `credit_limit_paise` data is done); refill-reminder _automation_ off `clinical.regular_meds` and the Razorpay **webhook → `record_payment`** auto-reconciliation are cross-module follow-ups.

## Related
[../domain/parties.md](../domain/parties.md) · [data-model.md](data-model.md) · [billing-screen.md](billing-screen.md) · [payments.md](payments.md) · [integrations-razorpay.md](integrations-razorpay.md) · [realtime.md](realtime.md) · [import-pipeline.md](import-pipeline.md)
