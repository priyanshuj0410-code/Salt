/**
 * Customer segments (SALT-048). Stored free-text in `ledgers.customer_group`
 * (migration 0032); the UI offers these standard values. Empty/null = ungrouped.
 */
export const CUSTOMER_GROUPS = ["Walk-in", "Regular", "Doctor", "Wholesale", "Corporate"] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];
