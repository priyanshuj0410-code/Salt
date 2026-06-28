import type { ModuleKey } from "@/lib/permissions";

/**
 * The 15 capability atoms (A..O) — the assignable building blocks of the V2 lens
 * (WS1). A user HOLDS a set of atoms; everything they see (lit surfaces, primary
 * surface, persistent action, altitude, Home tiles, gates) is DERIVED from that
 * set (see deriveLens). Ported verbatim from the validated prototype
 * wiki/design/salt-unified-experience.html (the model the SALT-1 reconciliation +
 * Varanasi test signed off).
 *
 * `modules` is the bridge to the V1 13-module nav (until WS2 re-homes nav to the
 * 8 V2 surfaces home/counter/buy/stock/money/comply/field/setup).
 */
export type AtomId =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O";

export interface CapabilityAtom {
  id: AtomId;
  label: string;
  group: string;
  /** V1 module(s) this atom lights — the bridge until WS2's surface re-home. */
  modules: ModuleKey[];
  /** One-line Home signal this atom contributes (consumed by the assembled Home, WS3). */
  home?: string;
  /** Inline capability gate this atom raises (fires for any holder — WS1 Slice 2). */
  gate?: string;
  /** Wholesale/godown atoms surfaced by the Varanasi test — assigned per user, not in a base role. */
  isNew?: boolean;
}

export const ATOMS: CapabilityAtom[] = [
  { id: "A", label: "Sell at counter", group: "At the counter", modules: ["counter"], home: "OOS asks · regulars" },
  { id: "B", label: "Bill & take payment", group: "At the counter", modules: ["counter", "sales"], home: "today's bills · cash" },
  { id: "C", label: "Dispense gate", group: "At the counter", modules: ["counter"], home: "H1/X today · expiring", gate: "H1 / X" },
  { id: "D", label: "Order stock", group: "Buy & stock", modules: ["purchases"], home: "reorder / low" },
  { id: "E", label: "Receive stock (GRN)", group: "Buy & stock", modules: ["purchases"], home: "GRNs to verify" },
  { id: "F", label: "Stock health", group: "Buy & stock", modules: ["inventory", "catalogue"], home: "expiring · dead stock" },
  { id: "G", label: "Field beat", group: "On the road", modules: ["salesmen"], home: "beat · cash in hand", gate: "credit before booking" },
  { id: "H", label: "Payments & collections", group: "Money", modules: ["payments"], home: "owed to me · collect today" },
  { id: "I", label: "Credit & approvals", group: "Money", modules: ["approvals", "payments"], home: "needs you", gate: "credit / discount" },
  { id: "J", label: "Keep the books", group: "Money", modules: ["reports", "parties"], home: "doesn't tie · unallocated" },
  { id: "K", label: "File GST & compliance", group: "Compliance", modules: ["gst"], home: "due to file · 2B mismatch" },
  { id: "L", label: "Pulse & reports", group: "Oversight", modules: ["reports", "activity"], home: "today's sales · pulse" },
  { id: "M", label: "Configure the shop", group: "Oversight", modules: ["settings"] },
  { id: "N", label: "Pick & fulfil", group: "Buy & stock", modules: ["inventory"], home: "pick queue · to dispatch", isNew: true },
  { id: "O", label: "Supply compliance", group: "Compliance", modules: ["gst"], home: "buyer licence · supply register", gate: "buyer licence", isNew: true },
];

export const ATOM_BY_ID: Record<AtomId, CapabilityAtom> =
  Object.fromEntries(ATOMS.map((a) => [a.id, a])) as Record<AtomId, CapabilityAtom>;
