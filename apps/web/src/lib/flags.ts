/**
 * Build-time feature flags. Spike-grade: a single env constant, no DB, no server
 * round-trip — so production and any dev who doesn't opt in run pure V1.
 *
 * LENS_V2 toggles the SALT-2 capability-lens spine (WS1). Off by default. Set
 * `VITE_LENS_V2=1` in apps/web/.env.local to drive the route gate + nav surface
 * from `deriveLens()` instead of the role-default matrix.
 */
export const LENS_V2 = (import.meta.env.VITE_LENS_V2 as string | undefined) === "1";
