import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";

/**
 * Credit / debit notes (SALT-061) — a read view on /payments. A credit note is a
 * sales return (reduces a customer's receivable) linked to its originating
 * sales invoice; a debit note is a purchase/expiry return (reduces a vendor
 * payable) linked to its purchase. Both already exist (0020 returns); this
 * surfaces them with their links. Read-only — creation lives in the returns flow.
 */
type NoteKind = "credit" | "debit";

interface NoteRow {
  id: string;
  kind: NoteKind;
  party_id: string | null;
  againstRef: string | null;
  note_no: string | null;
  note_date: string;
  reason: string | null;
  total_paise: number;
  status: string;
}

type KindFilter = "all" | NoteKind;

export function CreditDebitNotes({ orgId, nameById }: { orgId: string | null; nameById: Map<string, string> }) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    (async () => {
      const [credits, debits] = await Promise.all([
        selectAll<{
          id: string;
          party_id: string | null;
          sale_invoice_id: string | null;
          note_no: string | null;
          note_date: string;
          reason: string | null;
          total_paise: number;
          status: string;
        }>((from, to) =>
          supabase!
            .from("credit_notes")
            .select("id,party_id,sale_invoice_id,note_no,note_date,reason,total_paise,status")
            .eq("org_id", orgId)
            .order("note_date", { ascending: false })
            .range(from, to),
        ),
        selectAll<{
          id: string;
          vendor_id: string | null;
          purchase_id: string | null;
          note_no: string | null;
          note_date: string;
          reason: string | null;
          total_paise: number;
          status: string;
        }>((from, to) =>
          supabase!
            .from("debit_notes")
            .select("id,vendor_id,purchase_id,note_no,note_date,reason,total_paise,status")
            .eq("org_id", orgId)
            .order("note_date", { ascending: false })
            .range(from, to),
        ),
      ]);

      // Resolve originating-document refs.
      const ref = new Map<string, string>();
      const saleIds = credits.map((c) => c.sale_invoice_id).filter((x): x is string => !!x);
      const purchaseIds = debits.map((d) => d.purchase_id).filter((x): x is string => !!x);
      if (saleIds.length) {
        const { data } = await supabase!.from("sales_invoices").select("id,invoice_no").in("id", saleIds);
        for (const r of (data as { id: string; invoice_no: string | null }[] | null) ?? [])
          ref.set(r.id, r.invoice_no || "Invoice");
      }
      if (purchaseIds.length) {
        const { data } = await supabase!.from("purchases").select("id,vendor_invoice_no").in("id", purchaseIds);
        for (const r of (data as { id: string; vendor_invoice_no: string | null }[] | null) ?? [])
          ref.set(r.id, r.vendor_invoice_no || "Purchase");
      }

      const merged: NoteRow[] = [
        ...credits.map((c) => ({
          id: c.id,
          kind: "credit" as const,
          party_id: c.party_id,
          againstRef: c.sale_invoice_id ? (ref.get(c.sale_invoice_id) ?? null) : null,
          note_no: c.note_no,
          note_date: c.note_date,
          reason: c.reason,
          total_paise: c.total_paise,
          status: c.status,
        })),
        ...debits.map((d) => ({
          id: d.id,
          kind: "debit" as const,
          party_id: d.vendor_id,
          againstRef: d.purchase_id ? (ref.get(d.purchase_id) ?? null) : null,
          note_no: d.note_no,
          note_date: d.note_date,
          reason: d.reason,
          total_paise: d.total_paise,
          status: d.status,
        })),
      ].sort((a, b) => (a.note_date < b.note_date ? 1 : a.note_date > b.note_date ? -1 : 0));

      if (active) {
        setNotes(merged);
        setLoading(false);
      }
    })().catch((e) => {
      if (active) {
        setError(e instanceof Error ? e.message : "Failed to load notes");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  const stats = useMemo(() => {
    let credit = 0;
    let debit = 0;
    for (const n of notes) {
      if (n.status === "cancelled") continue;
      if (n.kind === "credit") credit += n.total_paise;
      else debit += n.total_paise;
    }
    return { credit, debit, count: notes.length };
  }, [notes]);

  const visible = useMemo(() => (kind === "all" ? notes : notes.filter((n) => n.kind === kind)), [notes, kind]);

  return (
    <div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Credit notes" value={formatPaiseCompact(stats.credit)} valueTitle={formatPaise(stats.credit)} tone="success" hint="reduce customer receivable" />
        <StatCard label="Debit notes" value={formatPaiseCompact(stats.debit)} valueTitle={formatPaise(stats.debit)} hint="reduce vendor payable" />
        <StatCard label="Notes" value={stats.count.toLocaleString("en-IN")} />
      </div>

      <div className="mt-4 flex gap-1.5">
        {(["all", "credit", "debit"] as KindFilter[]).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={kind === k ? "default" : "outline"}
            onClick={() => setKind(k)}
            className="capitalize"
          >
            {k}
          </Button>
        ))}
      </div>

      <div className="mt-3">
        <DataTable
          cols="0.8fr 0.9fr 0.7fr 1.2fr 0.9fr 1fr 0.8fr"
          rows={visible}
          rowKey={(n) => `${n.kind}:${n.id}`}
          loading={loading}
          empty={
            <p className="px-3 py-6 text-sm text-text-tertiary">
              No credit or debit notes yet. They are created from the returns flow.
            </p>
          }
          columns={[
            {
              key: "date",
              header: "Date",
              cell: (n) => <span className="text-text-tertiary">{format(new Date(n.note_date), "d MMM yyyy")}</span>,
            },
            { key: "no", header: "Note no.", cell: (n) => <span className="font-mono text-xs">{n.note_no || "-"}</span> },
            {
              key: "kind",
              header: "Type",
              cell: (n) => (
                <Badge variant={n.kind === "credit" ? "success" : "warning"}>{n.kind === "credit" ? "Credit" : "Debit"}</Badge>
              ),
            },
            { key: "party", header: "Party", cell: (n) => <span className="font-medium">{(n.party_id && nameById.get(n.party_id)) || "-"}</span> },
            { key: "against", header: "Against", cell: (n) => <span className="text-text-tertiary">{n.againstRef || "-"}</span> },
            { key: "reason", header: "Reason", cell: (n) => <span className="truncate text-text-tertiary">{n.reason || "-"}</span> },
            {
              key: "amount",
              header: "Amount",
              numeric: true,
              cell: (n) => (
                <span className={n.status === "cancelled" ? "text-text-tertiary line-through" : ""}>
                  {formatPaise(n.total_paise)}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
