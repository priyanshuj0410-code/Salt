// Drop-all auto-detect router (Smart Import, SALT-153). A routing layer on top of
// the existing importers: fingerprint a dropped file by scoring its headers
// against every importer's field aliases (reusing autoMap), pick the best match
// above a threshold, and route it to that step. Ambiguous files fall back to the
// manual stepper. No new load logic — the steps do the importing.

import { ENTITIES, autoMap, extractTable, type FieldDef } from "@/lib/smartImport";
import { DOCUMENTS } from "@/lib/smartDocument";
import { PAYMENT_CONFIG } from "@/lib/smartPayment";

export type RouteKind = "ledger" | "party_gstin" | "entity" | "doc" | "payment";

export interface Candidate {
  /** The SmartImportPage step key this routes to. */
  stepKey: string;
  label: string;
  kind: RouteKind;
  fields: FieldDef[];
}

// A trial balance is report-structured (not a flat table), so we identify it by
// its signature columns rather than the ledgers EntityConfig (name/phone/gstin…),
// and route it to the bespoke LedgerStep (step key "ledgers").
const TRIAL_BALANCE_FIELDS: FieldDef[] = [
  { key: "particulars", label: "Particulars", required: true, aliases: ["particulars", "name", "account", "ledger", "party"] },
  { key: "opening", label: "Opening", aliases: ["opening", "opening balance", "op bal"] },
  { key: "debit", label: "Debit", aliases: ["debit"] },
  { key: "credit", label: "Credit", aliases: ["credit"] },
  { key: "closing", label: "Closing", required: true, aliases: ["closing", "closing balance", "balance", "cl bal"] },
];

export const CANDIDATES: Candidate[] = [
  ...ENTITIES.map((e): Candidate => ({
    stepKey: e.key,
    label: e.label,
    kind: e.key === "ledgers" ? "ledger" : e.key === "party_gstin" ? "party_gstin" : "entity",
    fields: e.key === "ledgers" ? TRIAL_BALANCE_FIELDS : e.fields,
  })),
  ...DOCUMENTS.map((d): Candidate => ({
    stepKey: d.key,
    label: d.label,
    kind: "doc",
    fields: [...d.headerFields, ...d.lineFields],
  })),
  { stepKey: PAYMENT_CONFIG.key, label: PAYMENT_CONFIG.label, kind: "payment", fields: PAYMENT_CONFIG.fields },
];

const ALL_FIELDS: FieldDef[] = CANDIDATES.flatMap((c) => c.fields);

export interface Match {
  stepKey: string;
  label: string;
  kind: RouteKind;
  score: number; // 0..1 field coverage
}

/**
 * Score a header set against one importer's fields. Returns 0 unless EVERY
 * required field maps (a register without its doc-no, or a master without its
 * name, is not that file); otherwise the fraction of fields that mapped.
 */
export function scoreFields(headers: string[], fields: FieldDef[]): number {
  if (fields.length === 0) return 0;
  const mapping = autoMap(headers, fields);
  const required = fields.filter((f) => f.required);
  if (required.some((f) => !mapping[f.key])) return 0;
  const mapped = fields.filter((f) => mapping[f.key]).length;
  return mapped / fields.length;
}

/** Rank every importer for a header set, best first, dropping zero scores. */
export function classifyHeaders(headers: string[]): Match[] {
  return CANDIDATES.map((c) => ({
    stepKey: c.stepKey,
    label: c.label,
    kind: c.kind,
    score: scoreFields(headers, c.fields),
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Below this coverage we route to the manual stepper rather than guess. */
export const CONFIDENCE_THRESHOLD = 0.34;

export interface FileClassification {
  headers: string[];
  matches: Match[];
  best: Match | null; // best above threshold, else null (→ manual)
}

/**
 * Extract the header row from a raw sheet matrix (reusing the report-aware
 * extractTable against the union of all importer fields), then classify it.
 */
export function classifyMatrix(matrix: string[][]): FileClassification {
  const { headers } = extractTable(matrix, ALL_FIELDS);
  const matches = classifyHeaders(headers);
  const best = matches.length > 0 && matches[0].score >= CONFIDENCE_THRESHOLD ? matches[0] : null;
  return { headers, matches, best };
}
