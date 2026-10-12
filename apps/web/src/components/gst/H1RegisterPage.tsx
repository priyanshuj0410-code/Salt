import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Download, Printer } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { filterH1Rows, regDate, h1RegisterToCsv, h1RegisterHtml, printH1Register, type H1Row } from "@/lib/h1";

const H1_COLS =
  "sold_at,drug_name,schedule,qty,batch_no,expiry,doctor_name,doctor_reg_no,patient_name,patient_address,pharmacist_id";

interface H1Fetch {
  sold_at: string;
  drug_name: string | null;
  schedule: string;
  qty: number;
  batch_no: string | null;
  expiry: string | null;
  doctor_name: string | null;
  doctor_reg_no: string | null;
  patient_name: string | null;
  patient_address: string | null;
  pharmacist_id: string | null;
}

const SCHEDULES = ["", "H1", "X", "H"] as const;

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function H1RegisterPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [from, setFrom] = useState(() => `${new Date().toISOString().slice(0, 8)}01`); // 1st of this month
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10)); // today
  const [schedule, setSchedule] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<H1Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const [regRes, profRes] = await Promise.all([
        supabase
          .from("h1_register")
          .select(H1_COLS)
          .eq("org_id", orgId)
          .eq("shop_id", shopId)
          .gte("sold_at", `${from}T00:00:00`)
          .lte("sold_at", `${to}T23:59:59`)
          .order("sold_at"),
        supabase.from("profiles").select("id,full_name"),
      ]);
      if (!active) return;
      const names = new Map<string, string>();
      for (const p of (profRes.data as unknown as { id: string; full_name: string | null }[] | null) ?? []) {
        if (p.full_name) names.set(p.id, p.full_name);
      }
      setRows(
        ((regRes.data as unknown as H1Fetch[] | null) ?? []).map((r) => ({
          soldAt: r.sold_at,
          drugName: r.drug_name ?? "-",
          schedule: r.schedule,
          qty: r.qty,
          batchNo: r.batch_no ?? "",
          expiry: r.expiry ?? "",
          doctorName: r.doctor_name ?? "",
          doctorRegNo: r.doctor_reg_no ?? "",
          patientName: r.patient_name ?? "",
          patientAddress: r.patient_address ?? "",
          pharmacist: (r.pharmacist_id && names.get(r.pharmacist_id)) || "",
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, from, to]);

  const filtered = useMemo(() => filterH1Rows(rows, schedule, query), [rows, schedule, query]);
  const h1Count = useMemo(() => filtered.filter((r) => r.schedule === "H1").length, [filtered]);
  const xCount = useMemo(() => filtered.filter((r) => r.schedule === "X").length, [filtered]);
  const rangeLabel = `${regDate(from)} to ${regDate(to)}`;

  const header = {
    shopName: shop?.name ?? "This shop",
    gstin: shop?.gstin ?? "",
    licenses: "",
    range: rangeLabel,
  };

  return (
    <Page width="lg">
      <PageHeader
        icon={ClipboardList}
        title="Schedule H1 / X register"
        subtitle={<span>{shop?.name ?? "This shop"} · dispensing log for the drug inspector (Drugs &amp; Cosmetics Rules)</span>}
        actions={
          <>
            <Button variant="outline" disabled={filtered.length === 0} onClick={() => download(`h1-register-${from}_${to}.csv`, h1RegisterToCsv(filtered), "text/csv")}>
              <Download /> CSV
            </Button>
            <Button disabled={filtered.length === 0} onClick={() => printH1Register(h1RegisterHtml(filtered, header))}>
              <Printer /> Print / PDF
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-[9.5rem]" aria-label="From date" />
        <span className="text-text-tertiary">→</span>
        <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-[9.5rem]" aria-label="To date" />
        <div className="ml-1 inline-flex overflow-hidden rounded-lg border border-border">
          {SCHEDULES.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setSchedule(s)}
              className={`px-2.5 py-1 text-sm ${schedule === s ? "bg-primary text-primary-foreground" : "bg-surface text-text-secondary hover:bg-surface-2"}`}
            >
              {s || "All"}
            </button>
          ))}
        </div>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search drug / doctor / patient" className="w-56" aria-label="Search" />
      </div>

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Pick a shop to view its H1/X register." />
      ) : !loading && rows.length === 0 ? (
        <EmptyState title="No H1/X dispensing in range" hint={`No Schedule H1/X sales recorded ${rangeLabel}. Widen the dates, or these are captured at checkout (the H1 gate).`} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3 sm:max-w-md">
            <StatCard label="Entries" value={filtered.length} />
            <StatCard label="Schedule H1" value={h1Count} />
            <StatCard label="Schedule X" value={xCount} tone={xCount > 0 ? "danger" : "default"} />
          </div>

          <DataTable<H1Row>
            cols="0.4fr 0.9fr 1.4fr 0.5fr 0.5fr 0.8fr 0.8fr 1.4fr 1.4fr 1fr"
            rows={filtered}
            rowKey={(r) => `${r.soldAt}|${r.drugName}|${r.batchNo}|${r.patientName}`}
            loading={loading}
            empty="No entries match the filter."
            columns={[
              { key: "sl", header: "#", numeric: true, cell: (_r) => filtered.indexOf(_r) + 1 },
              { key: "date", header: "Date", cell: (r) => <span className="tabular-nums">{regDate(r.soldAt)}</span> },
              { key: "drug", header: "Drug", cell: (r) => r.drugName },
              { key: "sch", header: "Sch", cell: (r) => r.schedule },
              { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
              { key: "batch", header: "Batch", cell: (r) => <span className="tabular-nums">{r.batchNo || "-"}</span> },
              { key: "expiry", header: "Expiry", cell: (r) => <span className="tabular-nums">{r.expiry || "-"}</span> },
              {
                key: "doctor",
                header: "Prescriber",
                cell: (r) => (
                  <div>
                    {r.doctorName || "-"}
                    {r.doctorRegNo && <div className="text-xs text-text-tertiary">Reg: {r.doctorRegNo}</div>}
                  </div>
                ),
              },
              {
                key: "patient",
                header: "Patient",
                cell: (r) => (
                  <div>
                    {r.patientName || "-"}
                    {r.patientAddress && <div className="text-xs text-text-tertiary">{r.patientAddress}</div>}
                  </div>
                ),
              },
              { key: "pharma", header: "Pharmacist", cell: (r) => r.pharmacist || "-" },
            ]}
          />
        </div>
      )}
    </Page>
  );
}
