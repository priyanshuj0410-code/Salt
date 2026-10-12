import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { format } from "date-fns";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { selectAll } from "@/lib/selectAll";
import { formatPaise } from "@/lib/currency";
import { parseStatementCsv, reconcile, type BankStatementLine, type PaymentListRow } from "@/lib/payments";

/**
 * Bank reconciliation (SALT-058) — an in-module tab on /payments. Import a bank
 * statement CSV into `bank_statement_lines`, auto-match it against recorded
 * payments (lib `reconcile`), and flag what is unmatched on either side. PDF
 * import is a deliberate follow-up (heavy in-browser parse).
 */
export function BankReconcile({
  orgId,
  payments,
  nameById,
}: {
  orgId: string | null;
  payments: PaymentListRow[];
  nameById: Map<string, string>;
}) {
  const shopId = useAuth().shopId;
  const [lines, setLines] = useState<BankStatementLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    selectAll<BankStatementLine>((from, to) =>
      supabase!
        .from("bank_statement_lines")
        .select("id,txn_date,amount_paise,description,reference")
        .eq("org_id", orgId)
        .order("txn_date", { ascending: false })
        .range(from, to),
    )
      .then((rows) => {
        if (active) setLines(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load statement");
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const recon = useMemo(() => reconcile(lines, payments), [lines, payments]);
  const paymentByLine = useMemo(() => {
    const m = new Map<string, PaymentListRow>();
    for (const x of recon.matched) m.set(x.line.id, x.payment);
    return m;
  }, [recon]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !supabase || !orgId) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const parsed = parseStatementCsv(await file.text());
      if (!parsed.length) {
        setError("No rows found: expected a CSV with date and amount (or debit & credit) columns.");
        return;
      }
      const { error: err } = await supabase.from("bank_statement_lines").insert(
        parsed.map((p) => ({
          org_id: orgId,
          shop_id: shopId,
          txn_date: p.txn_date,
          amount_paise: p.amount_paise,
          description: p.description,
          reference: p.reference,
        })),
      );
      if (err) {
        setError(err.message);
        return;
      }
      setInfo(`Imported ${parsed.length} statement line${parsed.length === 1 ? "" : "s"}.`);
      setReloadKey((k) => k + 1);
    } catch (x) {
      setError(x instanceof Error ? x.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        <Button onClick={() => fileRef.current?.click()} disabled={busy || !orgId}>
          <Upload /> {busy ? "Importing…" : "Import statement (CSV)"}
        </Button>
        <span className="text-xs text-text-tertiary">
          Credit is +, debit is −; lines auto-match recorded payments by amount and nearest date.
        </span>
      </div>
      {info && <p className="mt-3 text-sm text-success">{info}</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Statement lines" value={lines.length.toLocaleString("en-IN")} />
        <StatCard label="Matched" value={recon.matched.length.toLocaleString("en-IN")} tone="success" />
        <StatCard
          label="Unmatched lines"
          value={recon.unmatchedLines.length.toLocaleString("en-IN")}
          tone={recon.unmatchedLines.length ? "danger" : "default"}
          hint="on statement, no payment"
        />
        <StatCard
          label="Unrecorded"
          value={recon.unmatchedPayments.length.toLocaleString("en-IN")}
          tone={recon.unmatchedPayments.length ? "danger" : "default"}
          hint="payment, not on statement"
        />
      </div>

      {lines.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border px-3 py-6 text-sm text-text-tertiary">
          No statement imported yet. Import a bank-statement CSV to reconcile it against recorded payments.
        </p>
      ) : (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-text-primary">Statement lines</h3>
          <DataTable
            cols="0.8fr 1.6fr 0.9fr 1fr"
            rows={lines}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "date",
                header: "Date",
                cell: (l) => (
                  <span className="text-text-tertiary">
                    {l.txn_date ? format(new Date(l.txn_date), "d MMM yyyy") : "-"}
                  </span>
                ),
              },
              { key: "desc", header: "Description", cell: (l) => <span>{l.description || l.reference || "-"}</span> },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                cell: (l) => (
                  <span className={l.amount_paise >= 0 ? "text-success" : "text-danger"}>{formatPaise(l.amount_paise)}</span>
                ),
              },
              {
                key: "match",
                header: "Match",
                cell: (l) => {
                  const p = paymentByLine.get(l.id);
                  return p ? (
                    <Badge variant="success">{nameById.get(p.party_id) ?? "matched"}</Badge>
                  ) : (
                    <Badge variant="warning">unmatched</Badge>
                  );
                },
              },
            ]}
          />
        </div>
      )}

      {recon.unmatchedPayments.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-medium text-text-primary">Recorded payments not on the statement</h3>
          <DataTable
            cols="0.8fr 1.4fr 0.7fr 0.9fr"
            rows={recon.unmatchedPayments}
            rowKey={(p) => p.id}
            columns={[
              {
                key: "date",
                header: "Date",
                cell: (p) => <span className="text-text-tertiary">{format(new Date(p.payment_date), "d MMM yyyy")}</span>,
              },
              { key: "party", header: "Party", cell: (p) => <span className="font-medium">{nameById.get(p.party_id) ?? "-"}</span> },
              { key: "mode", header: "Mode", cell: (p) => <Badge variant="neutral" className="uppercase">{p.mode}</Badge> },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                cell: (p) => (
                  <span className={p.direction === "received" ? "text-success" : "text-danger"}>
                    {formatPaise(p.amount_paise)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
