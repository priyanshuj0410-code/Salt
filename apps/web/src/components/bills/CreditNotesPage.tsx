import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";

// SALT-032 — the sales-return ledger: a read-only sub-screen listing credit
// notes (sales returns) raised against bills. Stock-back / ledger reversal is
// owned by the create_credit_note RPC; this screen surfaces what was returned.

interface NoteRow {
  id: string;
  note_no: string | null;
  note_date: string;
  created_at: string;
  reason: string | null;
  total_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  party_id: string | null;
  ledgers: { name: string } | null;
}

interface NoteLine {
  id: string;
  name: string;
  batch_no: string | null;
  qty: number;
  rate_paise: number;
  line_total_paise: number;
}

const noteNo = (n: NoteRow) => n.note_no ?? `#${n.id.slice(0, 8)}`;

export function CreditNotesPage() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<NoteRow | null>(null);
  const [lines, setLines] = useState<NoteLine[] | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("credit_notes")
      .select(
        "id,note_no,note_date,created_at,reason,total_paise,taxable_paise,cgst_paise,sgst_paise,igst_paise,party_id,ledgers(name)",
      )
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as NoteRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  async function viewNote(n: NoteRow) {
    setOpen(n);
    setLines(null);
    if (!supabase) return;
    const { data } = await supabase
      .from("credit_note_lines")
      .select("id,name,batch_no,qty,rate_paise,line_total_paise")
      .eq("credit_note_id", n.id);
    setLines((data as NoteLine[] | null) ?? []);
  }

  const total = useMemo(() => rows.reduce((s, r) => s + r.total_paise, 0), [rows]);

  return (
    <>
      <Page width="md">
        <PageHeader
          icon={Undo2}
          title="Credit notes"
          subtitle={
            rows.length > 0
              ? `${rows.length} ${rows.length === 1 ? "note" : "notes"} · ${formatPaise(total)} returned`
              : "Sales returns — stock back in, the sale reversed"
          }
          actions={
            <Button variant="ghost" render={<Link to="/bills" />}>
              Back to bills
            </Button>
          }
        />

        <DataTable<NoteRow>
          rows={rows}
          rowKey={(n) => n.id}
          cols="1fr 1.4fr 1fr 0.9fr"
          onRowActivate={viewNote}
          loading={loading}
          empty={<EmptyState icon={Undo2} title="No credit notes yet" hint="Sales returns will appear here." />}
          columns={[
            {
              key: "date",
              header: "Date",
              cell: (n) => <span className="text-text-tertiary">{format(new Date(n.created_at), "d MMM, HH:mm")}</span>,
            },
            {
              key: "party",
              header: "Customer",
              cell: (n) => (
                <>
                  {n.ledgers?.name ?? "Walk-in"}
                  <span className="ml-1.5 text-xs text-text-tertiary">{noteNo(n)}</span>
                </>
              ),
            },
            {
              key: "reason",
              header: "Reason",
              cell: (n) => <span className="text-text-tertiary">{n.reason ?? "—"}</span>,
            },
            { key: "total", header: "Total", numeric: true, cell: (n) => formatPaise(n.total_paise) },
          ]}
        />
      </Page>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{open ? `${open.ledgers?.name ?? "Walk-in"} · ${noteNo(open)}` : "Credit note"}</DialogTitle>
          </DialogHeader>
          {lines === null ? (
            <p className="text-sm text-text-tertiary">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b border-border bg-surface px-3 py-1.5 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Total</span>
              </div>
              {lines.length === 0 ? (
                <div className="px-3 py-4 text-sm text-text-tertiary">No lines.</div>
              ) : (
                lines.map((l) => (
                  <div
                    key={l.id}
                    className="grid grid-cols-[1fr_0.4fr_0.6fr_0.6fr] gap-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 truncate">
                      {l.name}
                      {l.batch_no && <span className="ml-1 text-xs text-text-tertiary">{l.batch_no}</span>}
                    </span>
                    <span className="text-right tabular-nums">{l.qty}</span>
                    <span className="text-right tabular-nums">{formatPaise(l.rate_paise)}</span>
                    <span className="text-right tabular-nums">{formatPaise(l.line_total_paise)}</span>
                  </div>
                ))
              )}
              {open && (
                <div className="flex justify-between bg-surface px-3 py-2 text-sm font-medium">
                  <span>Total returned</span>
                  <span className="tabular-nums">{formatPaise(open.total_paise)}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
