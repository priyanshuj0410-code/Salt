import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { formatPaise, formatSigned } from "@/lib/currency";
import { signedAmount, type PaymentListRow } from "@/lib/payments";
import { RecordPaymentDialog, type PartyLite } from "./RecordPaymentDialog";

type DirFilter = "all" | "received" | "paid";

export function PaymentsPage() {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();

  const [payments, setPayments] = useState<PaymentListRow[]>([]);
  const [parties, setParties] = useState<PartyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dir, setDir] = useState<DirFilter>("all");
  const [q, setQ] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    Promise.all([
      selectAll<PaymentListRow>((from, to) =>
        supabase!
          .from("payments")
          .select("id,party_id,direction,payment_date,mode,amount_paise,reference,notes,status,created_at")
          .eq("org_id", orgId)
          .order("payment_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      selectAll<PartyLite>((from, to) =>
        supabase!.from("ledgers").select("id,name,type").eq("org_id", orgId).order("name").range(from, to),
      ),
    ])
      .then(([pays, leds]) => {
        if (!active) return;
        setPayments(pays);
        setParties(leds);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load payments");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of parties) m.set(p.id, p.name);
    return m;
  }, [parties]);

  const stats = useMemo(() => {
    let received = 0;
    let paid = 0;
    for (const p of payments) {
      if (p.direction === "received") received += p.amount_paise;
      else paid += p.amount_paise;
    }
    return { received, paid, net: received - paid, count: payments.length };
  }, [payments]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return payments.filter((p) => {
      if (dir !== "all" && p.direction !== dir) return false;
      if (!needle) return true;
      const name = (nameById.get(p.party_id) ?? "").toLowerCase();
      return name.includes(needle) || (p.reference ?? "").toLowerCase().includes(needle);
    });
  }, [payments, dir, q, nameById]);

  return (
    <Page width="lg">
      <PageHeader
        icon={Wallet}
        title="Payments"
        subtitle="Receipts from customers and payments to vendors, recorded against their ledger."
        actions={
          <Button onClick={() => setRecordOpen(true)} disabled={!orgId}>
            <Plus /> Record payment
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Received" value={formatPaise(stats.received)} tone="success" hint="money in from customers" />
        <StatCard label="Paid" value={formatPaise(stats.paid)} tone="danger" hint="money out to vendors" />
        <StatCard
          label="Net"
          value={formatSigned(stats.net)}
          tone={stats.net >= 0 ? "success" : "danger"}
          hint="received − paid"
        />
        <StatCard label="Entries" value={stats.count.toLocaleString("en-IN")} />
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {(["all", "received", "paid"] as DirFilter[]).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={dir === d ? "default" : "outline"}
              onClick={() => setDir(d)}
              className="capitalize"
            >
              {d}
            </Button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search party or reference…"
          className="h-9 max-w-xs"
        />
        <span className="text-xs text-text-tertiary">
          {visible.length === payments.length ? `${payments.length}` : `${visible.length} of ${payments.length}`} entries
        </span>
      </div>

      <div className="mt-3">
        <DataTable
          cols="0.9fr 1.4fr 0.8fr 0.7fr 1fr 0.9fr"
          rows={visible}
          rowKey={(p) => p.id}
          loading={loading}
          onRowActivate={(p) => navigate(`/parties/${p.party_id}`)}
          empty={
            <p className="px-3 py-6 text-sm text-text-tertiary">
              No payments recorded yet. Use “Record payment” to add one.
            </p>
          }
          columns={[
            {
              key: "date",
              header: "Date",
              cell: (p) => <span className="text-text-tertiary">{format(new Date(p.payment_date), "d MMM yyyy")}</span>,
            },
            { key: "party", header: "Party", cell: (p) => <span className="font-medium">{nameById.get(p.party_id) ?? "—"}</span> },
            {
              key: "dir",
              header: "Type",
              cell: (p) => (
                <Badge variant={p.direction === "received" ? "success" : "warning"}>
                  {p.direction === "received" ? "Received" : "Paid"}
                </Badge>
              ),
            },
            { key: "mode", header: "Mode", cell: (p) => <Badge variant="neutral" className="uppercase">{p.mode}</Badge> },
            { key: "ref", header: "Reference", cell: (p) => <span className="text-text-tertiary">{p.reference || "—"}</span> },
            {
              key: "amount",
              header: "Amount",
              numeric: true,
              cell: (p) => (
                <span className={p.direction === "received" ? "text-success" : "text-danger"}>
                  {formatSigned(signedAmount(p))}
                </span>
              ),
            },
          ]}
        />
      </div>

      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        parties={parties}
        onRecorded={() => {
          setRecordOpen(false);
          setReloadKey((k) => k + 1);
        }}
      />
    </Page>
  );
}
