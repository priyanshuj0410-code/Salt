import { useState } from "react";
import { FileUp, CheckCircle2, Users, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { parseFile } from "@/lib/smartParse";
import { autoMap, type FieldDef } from "@/lib/smartImport";
import { classifyParties } from "@/lib/classifyParties";
import { selectAll } from "@/lib/selectAll";

const CHUNK = 500;

const FIELDS: FieldDef[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["party", "ledger", "account", "customer", "supplier", "particulars", "party name"],
  },
  {
    key: "gstin",
    label: "GSTIN",
    aliases: ["gst", "gst no", "gst number", "tax id", "gstin no"],
  },
  {
    key: "phone",
    label: "Phone",
    aliases: ["mobile", "contact", "phone no", "mobile no", "telephone"],
  },
  {
    key: "address",
    label: "Address",
    aliases: ["city", "location", "add", "addr"],
  },
  {
    key: "state_code",
    label: "State code",
    aliases: ["state code", "statecode", "state", "place of supply"],
  },
];

interface PartyRow {
  name: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  state_code: string | null;
  /** The verbatim master row (every column), kept so nothing is discarded. */
  raw: Record<string, string>;
}

interface Match {
  ledgerId: string;
  incoming: PartyRow;
  /** Which fields are null on the ledger and non-null incoming — i.e. will actually change. */
  willUpdate: { gstin: boolean; phone: boolean; address: boolean; state_code: boolean };
  /** The ledger's existing `source` jsonb, so we merge rather than clobber it. */
  existingSource: Record<string, unknown>;
}

interface ReviewData {
  /** Every name-matched master row (all get their full row saved to `source`). */
  matched: Match[];
  unmatched: PartyRow[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

/** Keep only non-empty cells, so the stored source row stays compact. */
const pruneRow = (row: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (v != null && String(v).trim() !== "") out[k] = String(v).trim();
  return out;
};

export function PartyGstStep({
  orgId,
  onComplete,
}: {
  orgId: string | undefined;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"upload" | "review" | "result">("upload");
  const [review, setReview] = useState<ReviewData | null>(null);
  const [enrichedCount, setEnrichedCount] = useState(0);
  const [addedCount, setAddedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      // 1. Parse + auto-map columns (handles column-name variation generically).
      const parsed = await parseFile(file, FIELDS);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setError("No data found in that file.");
        return;
      }
      const mapping = autoMap(parsed.headers, FIELDS);

      // 2. Extract party rows (skip blanks, trim phone whitespace). `raw` keeps
      //    every column from the master so nothing is left behind (→ source).
      const rows: PartyRow[] = parsed.rows
        .map((row) => ({
          name: mapping.name ? (row[mapping.name] ?? "").trim() : "",
          gstin: mapping.gstin ? (row[mapping.gstin] ?? "").trim() || null : null,
          phone: mapping.phone ? (row[mapping.phone] ?? "").trim() || null : null,
          address: mapping.address ? (row[mapping.address] ?? "").trim() || null : null,
          state_code: mapping.state_code ? (row[mapping.state_code] ?? "").trim() || null : null,
          raw: pruneRow(row),
        }))
        .filter((r) => r.name !== "");

      if (rows.length === 0) {
        setError("No named parties found in the file. Check that it has a Name column.");
        return;
      }

      // 3. Collapse duplicate names in the master — first non-null wins per field.
      //    (Real masters legitimately repeat names; this avoids double updates.)
      const byName = new Map<string, PartyRow>();
      for (const r of rows) {
        const cur = byName.get(norm(r.name));
        if (!cur) {
          byName.set(norm(r.name), { ...r });
        } else {
          cur.gstin ??= r.gstin;
          cur.phone ??= r.phone;
          cur.address ??= r.address;
          cur.state_code ??= r.state_code;
          cur.raw = { ...r.raw, ...cur.raw }; // first-seen values win, but keep extra columns
        }
      }
      const incoming = [...byName.values()];

      // 4. Fetch existing ledgers for this org.
      if (!supabase || !orgId) {
        setError("Not connected to the database.");
        return;
      }
      type LedgerRow = {
        id: string;
        name: string;
        gstin: string | null;
        phone: string | null;
        address: string | null;
        state_code: string | null;
        source: Record<string, unknown> | null;
      };
      let ledgers: LedgerRow[];
      try {
        // Page past the 1000-row cap so all existing parties are matched against.
        ledgers = await selectAll<LedgerRow>((from, to) =>
          supabase!
            .from("ledgers")
            .select("id, name, gstin, phone, address, state_code, source")
            .eq("org_id", orgId)
            .range(from, to),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load parties");
        return;
      }

      if (ledgers.length === 0) {
        setError(
          "No parties found in your account. Import your ledgers first (Step 1), then come back here.",
        );
        return;
      }

      // 5. Match incoming master rows to existing ledgers by normalized name.
      //    Every match records the full master row to `source` (nothing left
      //    behind); typed fields are filled only where the ledger is missing them.
      const byNorm = new Map(ledgers.map((l) => [norm(l.name), l]));
      const matched: Match[] = [];
      const unmatched: PartyRow[] = [];

      for (const row of incoming) {
        const ledger = byNorm.get(norm(row.name));
        if (!ledger) {
          unmatched.push(row);
          continue;
        }
        matched.push({
          ledgerId: ledger.id,
          incoming: row,
          willUpdate: {
            gstin: row.gstin !== null && !ledger.gstin,
            phone: row.phone !== null && !ledger.phone,
            address: row.address !== null && !ledger.address,
            state_code: row.state_code !== null && !ledger.state_code,
          },
          existingSource: ledger.source ?? {},
        });
      }

      setReview({ matched, unmatched });
      setPhase("review");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!review || !supabase || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Enrich matched ledgers — fill null fields + record the master row.
      let enriched = 0;
      for (let i = 0; i < review.matched.length; i += CHUNK) {
        const slice = review.matched.slice(i, i + CHUNK);
        const results = await Promise.all(
          slice.map((m) => {
            // Always record the verbatim master row under source.gst_master
            // (merged, not clobbering the trial-balance source); fill typed
            // fields only where the ledger is missing them.
            const patch: Record<string, unknown> = {
              source: { ...m.existingSource, gst_master: m.incoming.raw },
            };
            if (m.willUpdate.gstin) patch.gstin = m.incoming.gstin;
            if (m.willUpdate.phone) patch.phone = m.incoming.phone;
            if (m.willUpdate.address) patch.address = m.incoming.address;
            if (m.willUpdate.state_code) patch.state_code = m.incoming.state_code;
            return supabase!.from("ledgers").update(patch).eq("id", m.ledgerId);
          }),
        );
        const firstErr = results.find((r) => r.error);
        if (firstErr?.error) {
          setError(firstErr.error.message);
          return;
        }
        enriched += slice.length;
      }
      setEnrichedCount(enriched);

      // 2. Add unmatched parties as new ledgers. The GST master is the shop's
      //    full party list; the trial balance only had those with a balance.
      //    Classify names, then insert with no opening balance.
      let added = 0;
      if (review.unmatched.length > 0) {
        const types = await classifyParties(review.unmatched.map((r) => r.name));
        for (let i = 0; i < review.unmatched.length; i += CHUNK) {
          const slice = review.unmatched.slice(i, i + CHUNK);
          const payload = slice.map((r) => ({
            org_id: orgId,
            name: r.name,
            type: types.get(r.name) ?? "customer",
            gstin: r.gstin,
            phone: r.phone,
            address: r.address,
            state_code: r.state_code,
            source: { gst_master: r.raw },
          }));
          const { error: ierr } = await supabase.from("ledgers").insert(payload);
          if (ierr) {
            setError(ierr.message);
            return;
          }
          added += payload.length;
        }
      }
      setAddedCount(added);
      setPhase("result");
    } finally {
      setBusy(false);
    }
  }

  // ---- upload phase ----
  if (phase === "upload") {
    return (
      <div className="rounded-lg border p-5">
        <div className="mb-4">
          <p className="text-sm">
            Enrich your imported parties with GSTIN, address, phone and state from your GST master.
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            Drop your <span className="font-medium text-foreground">Party GST master</span> export
            (the &ldquo;partygstmaster&rdquo; file from Marg/Saral). We match by name and fill in any
            missing details: existing data is never overwritten.
          </p>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-text-tertiary hover:bg-surface-2/40"
        >
          <FileUp className="size-6" />
          <span>
            Drop your <span className="font-medium text-foreground">party GST master</span> here, or
            click to choose
          </span>
          <span className="text-xs">CSV, XLS or XLSX</span>
          <input
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>

        {busy && <p className="mt-3 text-sm text-text-tertiary">Reading file…</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-3 text-center">
          <button onClick={onComplete} className="text-xs text-text-tertiary hover:text-foreground">
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ---- review phase ----
  if (phase === "review" && review) {
    const { matched, unmatched } = review;
    const gstinCount = matched.filter((m) => m.willUpdate.gstin).length;
    const phoneCount = matched.filter((m) => m.willUpdate.phone).length;
    const addressCount = matched.filter((m) => m.willUpdate.address).length;
    const stateCount = matched.filter((m) => m.willUpdate.state_code).length;

    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-primary" />
          <span className="font-medium">Review what we found</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Matched (enriched)" value={matched.length} />
          <Stat label="New parties (added)" value={unmatched.length} />
          <Stat label="New GSTINs" value={gstinCount} />
        </div>

        {matched.length > 0 && (
          <div className="mt-4 space-y-1.5 text-sm">
            {gstinCount > 0 && <QaLine text={`${gstinCount} existing parties will get a GSTIN`} />}
            {stateCount > 0 && <QaLine text={`${stateCount} existing parties will get a state code`} />}
            {phoneCount > 0 && <QaLine text={`${phoneCount} existing parties will get a phone number`} />}
            {addressCount > 0 && <QaLine text={`${addressCount} existing parties will get an address`} />}
            <p className="text-xs text-text-tertiary">
              Missing fields are filled (existing values never overwritten); the full master row is
              saved to each party so no column is lost.
            </p>
          </div>
        )}

        {unmatched.length > 0 && (
          <details className="mt-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm text-text-tertiary">
              <UserPlus className="size-4 text-primary" />
              {unmatched.length} new parties will be added (not in your ledgers yet)
            </summary>
            <div className="mt-2 max-h-40 overflow-auto rounded-md border bg-surface-2/30 p-2 text-xs">
              {unmatched.slice(0, 30).map((u, i) => (
                <div key={i} className="py-0.5 text-text-tertiary">
                  {u.name}
                </div>
              ))}
              {unmatched.length > 30 && (
                <p className="pt-1 text-text-tertiary">+{unmatched.length - 30} more</p>
              )}
            </div>
            <p className="mt-1 text-xs text-text-tertiary">
              The trial balance only lists parties with an open balance; these are the rest of your
              customers and suppliers from the GST master. They&apos;re added with no opening balance
              and auto-tagged customer/vendor: fix any tags later from the Parties screen.
            </p>
          </details>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          {matched.length + unmatched.length > 0 ? (
            <Button onClick={runImport} disabled={busy}>
              <Users />
              {busy ? "Importing…" : importLabel(matched.length, unmatched.length)}
            </Button>
          ) : (
            <Button onClick={onComplete}>Continue to next step</Button>
          )}
          <Button variant="ghost" onClick={() => setPhase("upload")} disabled={busy}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  // ---- result phase ----
  return (
    <div className="rounded-lg border p-5">
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-emerald-600" />
        <span className="font-medium text-emerald-700 dark:text-emerald-400">
          Enriched {enrichedCount} {enrichedCount === 1 ? "party" : "parties"}
          {addedCount > 0 && ` and added ${addedCount} new ${addedCount === 1 ? "party" : "parties"}`}
        </span>
      </div>
      <p className="mt-2 text-sm text-text-tertiary">
        You can review and edit party details any time from the Parties screen.
      </p>
      <div className="mt-4">
        <Button onClick={onComplete}>Continue to next step</Button>
      </div>
    </div>
  );
}

/** Button label that adapts to whether we're enriching, adding, or both. */
function importLabel(matched: number, added: number): string {
  if (matched > 0 && added > 0) return `Enrich ${matched} & add ${added} parties`;
  if (added > 0) return `Add ${added} parties`;
  return `Enrich ${matched} parties`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-surface-2/30 p-3">
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-text-tertiary">{label}</div>
    </div>
  );
}

function QaLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      <span className="text-text-tertiary">{text}</span>
    </div>
  );
}
