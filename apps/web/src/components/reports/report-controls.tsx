import { Download } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { presetRange, type RangePreset } from "@/lib/reports";
import { ALL_SHOPS, type OrgShop } from "@/components/reports/useOrgShops";

/**
 * Shop scope selector for the report suites (SALT-118): "All shops" (org-wide,
 * consolidated) or a single shop. Renders nothing for single-shop orgs — the
 * report already runs org-wide, so there is nothing to switch.
 */
export function ShopSelect({
  shops,
  value,
  onChange,
}: {
  shops: OrgShop[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (shops.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Shop scope"
      className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:border-ring"
    >
      <option value={ALL_SHOPS}>All shops</option>
      {shops.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** A switchable view in a report suite (segmented control). */
export interface ReportView<T extends string> {
  key: T;
  label: string;
}

/** Segmented control for switching report views. */
export function ViewTabs<T extends string>({
  views,
  value,
  onChange,
}: {
  views: ReportView<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-input bg-surface p-0.5" role="tablist">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={value === v.key}
          onClick={() => onChange(v.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            value === v.key
              ? "bg-background text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "fy", label: "This FY" },
];

/** A from/to date range with quick presets — the standard report period picker. */
export function RangeControls({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <Button key={p.key} variant="ghost" size="xs" onClick={() => onChange(presetRange(p.key))}>
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className="w-[9.25rem]"
          aria-label="From date"
        />
        <span className="text-text-tertiary">→</span>
        <Input
          type="date"
          value={to}
          min={from}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className="w-[9.25rem]"
          aria-label="To date"
        />
      </div>
    </div>
  );
}

/** Export-to-CSV button, disabled when there is nothing to export. */
export function ExportButton({ onExport, disabled }: { onExport: () => void; disabled?: boolean }) {
  return (
    <Button variant="outline" onClick={onExport} disabled={disabled}>
      <Download /> CSV
    </Button>
  );
}
