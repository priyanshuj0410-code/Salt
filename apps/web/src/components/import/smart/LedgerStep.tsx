import { useState } from "react";
import { FileUp, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { parseLedgerFile } from "@/lib/smartParse";
import { quality, type LedgerReport, type LedgerQuality } from "@/lib/smartLedger";
import { classifyParties, type PartyType } from "@/lib/classifyParties";

const CHUNK = 500;

interface ImportResult {
  ledgers: number;
  bills: number;
}

export function LedgerStep({
  orgId,
  onComplete,
}: {
  orgId: string | undefined;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"upload" | "review" | "result">("upload");
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [qa, setQa] = useState<LedgerQuality | null>(null);
  const [types, setTypes] = useState<Map<string, PartyType>>(new Map());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const rep = await parseLedgerFile(file);
      if (rep.ledgers.length === 0) {
        setError("No ledgers found in that file. Is it a trial balance / ledger export?");
        return;
      }
      setReport(rep);
      setQa(quality(rep));
      setTypes(await classifyParties(rep.ledgers.map((l) => l.name)));
      setPhase("review");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!report || !supabase || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      let ledgerCount = 0;
      let billCount = 0;
      for (let i = 0; i < report.ledgers.length; i += CHUNK) {
        const slice = report.ledgers.slice(i, i + CHUNK);
        // Generate each ledger's UUID client-side so bills link by explicit id,
        // never by relying on the order Postgres returns inserted rows in.
        const withId = slice.map((l) => ({ ledger: l, id: crypto.randomUUID() }));
        const payload = withId.map(({ ledger: l, id }) => ({
          id,
          org_id: orgId,
          name: l.name,
          type: types.get(l.name) ?? "customer",
          opening_balance_paise: l.openingBalancePaise,
          phone: l.phone || null,
          // Keep the trial-balance source under a namespaced key so the party-GST
          // step can add `gst_master` alongside without clobbering it (0013).
          source: {
            trial_balance: {
              name: l.name,
              opening_balance_paise: l.openingBalancePaise,
              phone: l.phone || null,
              bill_count: l.bills.length,
            },
          },
        }));
        const { error: lerr } = await supabase.from("ledgers").insert(payload);
        if (lerr) {
          setError(lerr.message);
          return;
        }
        ledgerCount += payload.length;

        const bills: Record<string, unknown>[] = [];
        withId.forEach(({ ledger: l, id }) => {
          for (const b of l.bills) {
            bills.push({
              org_id: orgId,
              ledger_id: id,
              ref_no: b.refNo || null,
              bill_date: b.billDate,
              amount_paise: b.amountPaise,
              nature: b.nature,
              due_date: b.dueDate,
              days_overdue: b.daysOverdue,
            });
          }
        });
        for (let j = 0; j < bills.length; j += CHUNK) {
          const { error: berr } = await supabase.from("ledger_bills").insert(bills.slice(j, j + CHUNK));
          if (berr) {
            setError(berr.message);
            return;
          }
        }
        billCount += bills.length;
      }
      setResult({ ledgers: ledgerCount, bills: billCount });
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
            Your parties — customers and vendors/distributors. Import these first.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Drop your <span className="font-medium text-foreground">trial balance</span> export. We
            read each party&apos;s outstanding balance and open bills, and tag them as customer,
            vendor or other automatically — you can fix any later.
          </p>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-muted/40"
        >
          <FileUp className="size-6" />
          <span>
            Drop your <span className="font-medium text-foreground">ledgers</span> file here, or click
            to choose
          </span>
          <span className="text-xs">CSV, XLS or XLSX</span>
          <input
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        {busy && <p className="mt-3 text-sm text-muted-foreground">Reading file…</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-3 text-center">
          <button onClick={onComplete} className="text-xs text-muted-foreground hover:text-foreground">
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ---- review phase ----
  if (phase === "review" && report && qa) {
    const customers = report.ledgers.filter((l) => (types.get(l.name) ?? "customer") === "customer").length;
    const vendors = report.ledgers.filter((l) => types.get(l.name) === "vendor").length;
    const others = report.ledgers.filter((l) => types.get(l.name) === "other").length;
    const allBalanced = qa.unbalanced.length === 0;

    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-primary" />
          <span className="font-medium">Review what we found</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Ledgers" value={qa.ledgerCount} />
          <Stat label="Open bills" value={qa.billCount} />
          <Stat label="Customers" value={customers} />
          <Stat label="Vendors" value={vendors} />
        </div>

        {/* Quality checks */}
        <div className="mt-4 space-y-1.5 text-sm">
          <QaLine
            ok={allBalanced}
            okText={`All ${qa.balanced} ledgers reconcile (opening + debit − credit = closing)`}
            badText={`${qa.unbalanced.length} of ${qa.ledgerCount} ledgers don't reconcile`}
          />
          <QaLine
            ok={qa.invalidBills === 0}
            okText="Every bill parsed cleanly"
            badText={`${qa.invalidBills} bills are missing a date, amount or Dr/Cr`}
          />
          <QaLine
            ok={qa.unparsedLines === 0}
            okText="No unreadable bill lines"
            badText={`${qa.unparsedLines} bill lines could not be read`}
          />
          <p className="text-xs text-muted-foreground">
            Tagged {customers} customers, {vendors} vendors, {others} other (control accounts). Fix
            mistags later from the Parties screen.
          </p>
        </div>

        {/* Unbalanced detail (first few) */}
        {!allBalanced && (
          <div className="mt-3 max-h-40 overflow-auto rounded-md border bg-amber-500/5 p-2 text-xs">
            {qa.unbalanced.slice(0, 20).map((u) => (
              <div key={u.name} className="flex justify-between gap-3 py-0.5">
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  closing {(u.closingPaise / 100).toLocaleString("en-IN")} vs computed{" "}
                  {(u.computedPaise / 100).toLocaleString("en-IN")}
                </span>
              </div>
            ))}
            {qa.unbalanced.length > 20 && (
              <p className="pt-1 text-muted-foreground">+{qa.unbalanced.length - 20} more</p>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={runImport} disabled={busy}>
            <Upload />
            {busy ? "Importing…" : `Import ${qa.ledgerCount} ledgers + ${qa.billCount} bills`}
          </Button>
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
          Imported {result?.ledgers ?? 0} ledgers and {result?.bills ?? 0} open bills
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Opening balances and party tags are saved. You can review and fix tags from the Parties
        screen.
      </p>
      <div className="mt-4">
        <Button onClick={onComplete}>Continue to next step</Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function QaLine({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
      )}
      <span className={ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-500"}>
        {ok ? okText : badText}
      </span>
    </div>
  );
}
