// SALT-030 — pure bill-history filtering. Free of React/Supabase so it is
// unit/smoke-testable and reused by the history screen over the already-loaded
// page set (client-side, AND-composed).

export type DatePreset = "" | "today" | "yesterday" | "week" | "month";

export interface BillFilterRow {
  invoice_no: string | null;
  created_at: string;
  payment_method: string | null;
  party_id: string | null;
  ledgers: { name: string } | null;
}

export interface BillFilters {
  q: string; // free text over invoice no + customer name
  preset: DatePreset; // "" = all time
  party: string; // "" = any | "walkin" | <party_id>
  mode: string; // "" = any | cash | credit | ...
}

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export const PAYMENT_MODE_OPTIONS = [
  { value: "", label: "All modes" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank" },
  { value: "credit", label: "Credit" },
];

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

/** Resolve a preset to an inclusive [from, to] ms range, or null for "all time". */
export function presetRange(preset: DatePreset, now: Date = new Date()): { from: number; to: number } | null {
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "week": {
      const s = new Date(now);
      const dow = (s.getDay() + 6) % 7; // Monday = 0
      s.setDate(s.getDate() - dow);
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    default:
      return null;
  }
}

export function hasActiveFilter(f: BillFilters): boolean {
  return f.q.trim() !== "" || f.preset !== "" || f.party !== "" || f.mode !== "";
}

/** AND-compose all active filters over the loaded rows. */
export function filterBills<T extends BillFilterRow>(rows: T[], f: BillFilters, now: Date = new Date()): T[] {
  const needle = f.q.trim().toLowerCase();
  const range = presetRange(f.preset, now);
  return rows.filter((r) => {
    if (needle) {
      const hay = `${r.invoice_no ?? ""} ${r.ledgers?.name ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (range) {
      const ts = new Date(r.created_at).getTime();
      if (ts < range.from || ts > range.to) return false;
    }
    if (f.mode && (r.payment_method ?? "") !== f.mode) return false;
    if (f.party) {
      if (f.party === "walkin") {
        if (r.party_id) return false;
      } else if (r.party_id !== f.party) {
        return false;
      }
    }
    return true;
  });
}
