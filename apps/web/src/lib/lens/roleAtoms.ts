import type { UserRole } from "@/lib/auth";
import type { AtomId } from "./atoms";

/**
 * The 5 V1 roles expressed as capability-atom presets — the validated prototype
 * presets (wiki/design/salt-unified-experience.html). WS1 Slice 1 derives a
 * user's held atoms from their role; per-user atom assignment (and N/O — godown
 * pick-fulfil, wholesale supply-compliance, which sit in no base role) is a later
 * slice. This is the source the lens derives from; `litModules` gating still
 * runs through `can()` in Slice 1, so there is no access regression.
 */
export const ROLE_ATOMS: Record<UserRole, AtomId[]> = {
  owner: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"],
  manager: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
  accountant: ["H", "J", "K", "L"],
  pharmacist: ["A", "C", "F"],
  cashier: ["B"],
};

export function atomsForRole(role: UserRole | undefined): Set<AtomId> {
  return new Set(role ? ROLE_ATOMS[role] ?? [] : []);
}
