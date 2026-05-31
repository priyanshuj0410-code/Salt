/** A column-mapping group: for each field, a dropdown to pick its source header.
 *  Shared by the document (header+line) and payment (flat) import steps. */
export function MapGroup({
  title,
  fields,
  mapping,
  headers,
  onChange,
}: {
  title: string;
  fields: { key: string; label: string; required?: boolean }[];
  mapping: Record<string, string | null>;
  headers: string[];
  onChange: (m: Record<string, string | null>) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.key} className="grid grid-cols-[1fr_1.5fr] items-center gap-3 text-sm">
            <span>
              {f.label}
              {f.required && <span className="ml-1 text-destructive">*</span>}
            </span>
            <select
              value={mapping[f.key] ?? ""}
              onChange={(e) => onChange({ ...mapping, [f.key]: e.target.value || null })}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">— not mapped —</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
