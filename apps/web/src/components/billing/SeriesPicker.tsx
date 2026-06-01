/**
 * Per-bill GST series selector (SALT-209). Hidden unless the shop runs more than one active
 * sales series; otherwise picking a series threads its `p_series_id` into the next save, so the
 * server allocates the printed invoice number from that series (e.g. RETAIL vs WS).
 */
export function SeriesPicker({
  series,
  value,
  onChange,
}: {
  series: { id: string; code: string; is_default: boolean }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (series.length <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-text-tertiary">Invoice series</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Invoice series"
        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {series.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code}
            {s.is_default ? " (default)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
