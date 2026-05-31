import type { Item } from "./types";

/** Normalize a name for collision detection: lowercase, punctuation→space, collapse. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface DuplicateGroup {
  key: string;
  /** A representative display name for the group. */
  label: string;
  items: Item[];
}

/**
 * Find likely-duplicate items — the *same product entered twice* (e.g. "Dolo 650",
 * "DOLO-650", "Dolo 650 Tab" from the same maker), which imports and ad-hoc GRN
 * additions create. Grouped by normalized name + manufacturer.
 *
 * This is deliberately NOT same-salt matching: a different brand of the same salt
 * is a legitimate distinct item (that is a substitute, see lib/substitutes.ts),
 * never a duplicate. Returns only groups with two or more members, most first.
 */
export function findDuplicateGroups(items: Item[]): DuplicateGroup[] {
  const byKey = new Map<string, Item[]>();
  for (const i of items) {
    const n = norm(i.name);
    if (!n) continue;
    const key = `${n}|${norm(i.manufacturer)}`;
    const arr = byKey.get(key);
    if (arr) arr.push(i);
    else byKey.set(key, [i]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    groups.push({ key, label: group[0].name, items: group });
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  return groups;
}
