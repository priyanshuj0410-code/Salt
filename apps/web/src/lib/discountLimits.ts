/**
 * Org discount policy + the checkout gate check (SALT-206 / follow-on of SALT-016).
 *
 * Settings → Discount limits stores the policy in `org_settings.settings`:
 *   { discount_max_pct: number|null, discount_max_paise: number|null }   (blank = no limit)
 *
 * At checkout, a bill whose total discount (line + bill-level) exceeds either cap is
 * blocked until a manager approves it via the approvals inbox. These helpers are pure
 * so they can drive both the Save gate and the approval summary, and be smoke-tested.
 * Money is integer paise.
 */

export interface DiscountLimits {
  /** Max discount as a percentage of gross (0–100); null = no percentage cap. */
  maxPct: number | null;
  /** Max discount as a flat amount in paise; null = no flat cap. */
  maxPaise: number | null;
}

export const NO_DISCOUNT_LIMITS: DiscountLimits = { maxPct: null, maxPaise: null };

/** Read the typed limits out of the `org_settings.settings` blob (blank/invalid → null). */
export function parseDiscountLimits(settings: Record<string, unknown> | null | undefined): DiscountLimits {
  const pct = settings?.discount_max_pct;
  const paise = settings?.discount_max_paise;
  return {
    maxPct: typeof pct === "number" && pct >= 0 ? pct : null,
    maxPaise: typeof paise === "number" && paise >= 0 ? paise : null,
  };
}

export interface DiscountCheck {
  /** Over either configured cap → checkout needs a manager override. */
  over: boolean;
  /** Total discount being applied, in paise (line + bill-level). */
  discountPaise: number;
  /** That discount as a percentage of gross (0 when gross is 0). */
  pct: number;
  overPct: boolean;
  overPaise: boolean;
}

/**
 * Is the bill's total discount over the org's limit? No cap set (both null) → never
 * over (gate disabled, behaviour unchanged). A tiny epsilon avoids tripping on float
 * rounding right at the boundary (e.g. 10.0000001% vs a 10% cap).
 */
export function checkDiscountLimit(
  limits: DiscountLimits,
  grossPaise: number,
  discountPaise: number,
): DiscountCheck {
  const pct = grossPaise > 0 ? (discountPaise / grossPaise) * 100 : 0;
  const overPct = limits.maxPct !== null && pct > limits.maxPct + 1e-9;
  const overPaise = limits.maxPaise !== null && discountPaise > limits.maxPaise;
  return { over: overPct || overPaise, discountPaise, pct, overPct, overPaise };
}
