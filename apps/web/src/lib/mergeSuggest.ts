// Suggest which party ledgers are likely the same real party and should be
// merged. Pure (takes a plain party list). Signals, highest confidence first:
//   1. same GSTIN          -> same legal entity (debtor + creditor of one party)
//   2. identical bill set  -> an accidental re-import (same invoices twice)
//   3. same normalized name -> a candidate for human review
// A party lands in at most one group, claimed by its highest-confidence signal.
// Nothing here mutates data — the user confirms each merge in the UI.

export interface PartyLite {
  id: string;
  name: string;
  gstin: string | null;
  type: string;
  openingBalancePaise: number;
  /** bill ref_nos (invoice ids); may contain blanks/dupes. */
  billRefs: string[];
  billCount: number;
}

export type MergeReason = "gstin" | "invoice-set" | "name";

export interface MergeGroup {
  reason: MergeReason;
  confidence: "high" | "medium";
  /** short human label for the shared key. */
  label: string;
  parties: PartyLite[];
}

const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normGstin = (s: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Stable signature of a party's open-bill set (sorted unique non-empty refs). */
export function billSignature(refs: string[]): string {
  const uniq = [...new Set(refs.map((r) => (r ?? "").trim()).filter(Boolean))].sort();
  return uniq.join("|");
}

export function suggestMerges(parties: PartyLite[]): MergeGroup[] {
  const claimed = new Set<string>();
  const groups: MergeGroup[] = [];

  const groupBy = (
    keyFn: (p: PartyLite) => string,
    reason: MergeReason,
    confidence: "high" | "medium",
    labelFn: (bucket: PartyLite[]) => string,
  ) => {
    const buckets = new Map<string, PartyLite[]>();
    for (const p of parties) {
      if (claimed.has(p.id)) continue;
      const k = keyFn(p);
      if (!k) continue;
      const arr = buckets.get(k);
      if (arr) arr.push(p);
      else buckets.set(k, [p]);
    }
    for (const arr of buckets.values()) {
      if (arr.length < 2) continue;
      for (const p of arr) claimed.add(p.id);
      groups.push({ reason, confidence, label: labelFn(arr), parties: arr });
    }
  };

  groupBy((p) => normGstin(p.gstin), "gstin", "high", (b) => b[0].gstin ?? "");
  groupBy(
    (p) => billSignature(p.billRefs),
    "invoice-set",
    "high",
    (b) => `${billSignature(b[0].billRefs).split("|").filter(Boolean).length} identical bills`,
  );
  groupBy((p) => normName(p.name), "name", "medium", (b) => b[0].name);

  const rank = { high: 0, medium: 1 } as const;
  groups.sort(
    (a, b) => rank[a.confidence] - rank[b.confidence] || b.parties.length - a.parties.length,
  );
  return groups;
}
