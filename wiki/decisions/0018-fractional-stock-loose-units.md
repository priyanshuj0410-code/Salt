---
type: decision
updated: 2026-06-02
tags: [stock, batches, billing, sales]
---

# 0018 — Fractional stock: an integer loose-units component, not a base-unit rewrite

**Status:** accepted (SALT-233, the DB enabler for SALT-164 loose-unit sale).

## Context
`create_sales_invoice` decremented stock as whole packs (`batches.qty - v_qty`, integer),
so selling 4 tablets from a strip of 10 had no server representation. SALT-233 asks for a
fractional-pack / loose-unit decrement, keeping money in integer **paise** and FEFO + the
stock cap intact. The ticket offered two representations: **(a)** store `batches.qty` in
**base units** and convert at pack boundaries, or **(b)** add a fractional/loose component.
It preferred (a) "to keep stock + money off floats".

## Decision
Take **(b), implemented with integers** — the goal behind (a) (no floats) is met without
its migration hazard:

- `items.units_per_pack integer` (null ⇒ 1) — base units per pack (a 10-tablet strip = 10).
- `batches.loose_units integer not null default 0` — base units from the **currently-open**
  pack; `batches.qty` stays whole sealed **packs**. Total on hand = `qty * units_per_pack + loose_units`.
- `sale_lines.loose_units integer not null default 0` — base units sold loose on the line.
- `create_sales_invoice` takes an optional per-line `loose_units`; the decrement is done in
  **base units** and re-split back into packs + loose remainder:
  `avail = qty*upp + loose_units;  remain = avail − (qty_packs*upp + loose);  qty = remain/upp;  loose_units = remain%upp`
  (integer division/modulo — exact, no floats). The stock-cap guard is `avail ≥ units_removed`.
- `stock_movements.qty_delta` for a sale is recorded in **base units** (`= packs` when `upp = 1`).

## Why not (a), full base units
`batches.qty` currently holds **packs**. Converting every batch to base units needs a
per-item `units_per_pack`, which **does not exist for existing stock** — so the data
migration (`qty := qty * upp`) cannot be done safely (we would either guess `upp` or corrupt
counts). It also forces `qty` → a different unit for every reader (inventory views, GRN,
returns, adjustments, reports), a cross-cutting change far beyond one migration. The
loose-units hybrid is **additive** and needs **no data migration**.

## Consequences
- **Backward-compatible:** `units_per_pack` defaults to 1, `loose_units` to 0, so whole-pack
  sales are byte-identical to before (`qty := qty − v_qty`); the loose path only activates
  when `loose_units > 0` or `upp > 1`. Other RPCs (receive_purchase, returns, adjustments)
  are untouched — they keep adding/removing whole packs into `qty`.
- **No floats / no type changes:** all stock + money stay integer.
- Loose sale of a misconfigured item (no `units_per_pack`) treats `loose_units` as whole
  packs — so the client (SALT-164) must require `units_per_pack` before offering a loose sale.
- `stock_movements.qty_delta` is base units; for `upp > 1` items it is finer than packs (an
  intentional improvement for a loose-sellable item). Loose **purchase**/GRN is out of scope.

## Related
[architecture/data-model](../architecture/data-model.md) · [architecture/inventory](../architecture/inventory.md) · SALT-233 (DB) · SALT-164 (billing UI)
