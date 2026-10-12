// Opening stock-ledger reconciliation (Smart Import, SALT-183).
//
// The four-file cascade seeds on-hand as batches.qty but posts NO stock_movements,
// so the movement ledger is incomplete for imported stock: sales later post
// reason='sale' (negative) rows with no opening positive to balance against, so
// Σ movements != current qty. This posts one reason='opening' movement per
// imported batch so the ledger reconciles to batches.qty at cutover (ADR 0012).
//
// On-hand itself is unaffected — the inventory module reads on-hand from
// batches.qty (a cached value), not by summing movements (see lib/inventory.ts).
// So these rows are purely the audit/valuation ledger; posting them never
// double-counts stock. Idempotent: a batch that already has an opening movement
// is skipped.

export interface OpeningBatch {
  id: string;
  item_id: string | null;
  qty: number;
  ptr_paise: number;
  shop_id: string | null;
}

/** A DB-ready stock_movements row (minus org_id, added at insert). */
export interface OpeningMovement {
  shop_id: string;
  item_id: string;
  batch_id: string;
  qty_delta: number;
  reason: "opening";
  unit_cost_paise: number;
  ref_table: string;
}

export interface OpeningPlan {
  movements: OpeningMovement[];
  skippedExisting: number; // already had an opening movement
  skippedZero: number; // qty 0: nothing to open
  skippedNoShop: number; // no batch shop_id and no active shop to fall back to
  skippedNoItem: number; // no item_id (anomaly, normally quarantined at batch import)
}

/**
 * Plan the opening movements to insert. Each batch posts one `opening` movement
 * of `qty_delta = qty` and `unit_cost_paise = ptr_paise`, under the batch's own
 * shop (or the active shop when the batch is untagged). Skips batches that
 * already have an opening movement (idempotent re-run), zero-qty batches, and
 * (defensively) item-less batches.
 */
export function planOpeningMovements(
  batches: OpeningBatch[],
  existingOpeningBatchIds: Set<string>,
  activeShopId: string | null,
): OpeningPlan {
  const movements: OpeningMovement[] = [];
  let skippedExisting = 0;
  let skippedZero = 0;
  let skippedNoShop = 0;
  let skippedNoItem = 0;

  for (const b of batches) {
    if (!b.item_id) {
      skippedNoItem++;
      continue;
    }
    if (existingOpeningBatchIds.has(b.id)) {
      skippedExisting++;
      continue;
    }
    if (b.qty === 0) {
      skippedZero++;
      continue;
    }
    const shopId = b.shop_id ?? activeShopId;
    if (!shopId) {
      skippedNoShop++;
      continue;
    }
    movements.push({
      shop_id: shopId,
      item_id: b.item_id,
      batch_id: b.id,
      qty_delta: b.qty, // negative on-hand (oversold) imports faithfully as a negative opening
      reason: "opening",
      unit_cost_paise: b.ptr_paise,
      ref_table: "import",
    });
  }

  return { movements, skippedExisting, skippedZero, skippedNoShop, skippedNoItem };
}
