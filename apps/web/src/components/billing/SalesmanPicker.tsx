/**
 * Per-bill salesman selector (SALT-192). Hidden unless the shop has active salesmen; picking one
 * threads its `salesman_id` into the next `create_sales_invoice` so the bill is attributed to who
 * booked it (feeds the salesman performance / commission reports). "No salesman" clears it.
 */
export function SalesmanPicker({
  salesmen,
  value,
  onChange,
}: {
  salesmen: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (salesmen.length === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-text-tertiary">Salesman</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Salesman"
        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">No salesman</option>
        {salesmen.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
