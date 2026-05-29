---
type: domain
updated: 2026-05-29
---

# Parties (customers / vendors / others)

A **party** is any counterparty in the books — a customer, a vendor/distributor, or a control account. Stored in `ledgers` (one `uuid` per party), with open invoices in `ledger_bills`. Surfaced and managed on the owner-only **Parties screen** (`/parties`, `PartiesPage.tsx`).

## Classification (`type`)

`type ∈ {customer, vendor, other}`, assigned server-side by the **`classify_parties`** RPC (migration 0008), in priority order:

1. **other** — name matches a control-account keyword (cash, bank, SBI/HDFC/…, sales, purchase, GST/CGST/SGST/IGST, capital, discount, round-off, freight, rent, salary, TDS/TCS, …). Not a real trade party.
2. **vendor** — normalized name matches the `known_vendors` reference list (~70 seeded pharma companies; substring match, length ≥ 4).
3. **customer** — everything else (the default).

Classification is heuristic and **defaults to customer** when unsure (e.g. if the RPC is unavailable). The Parties screen is where the owner fixes mistags. **GSTIN is the intended canonical identity key** once parties have one (the trial balance carries none today).

## Balances & bills

- `opening_balance_paise` — signed (Dr `+` receivable / Cr `−` payable). The Parties screen shows it colored with a Dr/Cr label.
- `ledger_bills` — the party's open invoices (ref, date, amount, nature, due date, days overdue).

## Merge (de-duplication)

The trial balance repeats names for real reasons, so import is **faithful** and de-duplication is a **user-driven, suggest-and-confirm** merge — never automatic. `mergeSuggest.ts` groups candidates by, highest confidence first:

1. **same GSTIN** — same legal entity (correctly groups a vendor's debtor + creditor ledgers).
2. **identical invoice-id set** — same bill refs ⇒ an accidental re-import (high confidence).
3. **same normalized name** — review candidate (could be distinct accounts).

The owner picks a survivor and confirms; **`merge_ledgers`** (migration 0009) then atomically re-points bills to the survivor, **sums the signed balances** (net preserved), adopts missing gstin/phone/address, and deletes the merged rows.

Verified on the real file: a single faithful import surfaces ~15 name-candidate groups and **0** invoice-set groups; a simulated double-import surfaces 353 invoice-set pairs (the re-import detector). See [decisions/0005-faithful-import-and-merge](../decisions/0005-faithful-import-and-merge.md).

## Related
[trial-balance](trial-balance.md) · [import-pipeline](../architecture/import-pipeline.md) · [data-model](../architecture/data-model.md)
