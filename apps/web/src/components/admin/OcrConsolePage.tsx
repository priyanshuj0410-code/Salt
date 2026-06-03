import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Activity, Ban, ChevronUp, Loader2, RotateCcw, Server, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { scanStatusLabel, scanStatusVariant, type ScanLane, type ScanStatus } from "@/lib/invoiceScans";

/**
 * Operator console (M5, prd-gemma-ocr-worker.md) — Salt-admin only. Cross-tenant view
 * of the two-lane OCR queue: live queue + worker health + throughput/cost metrics, with
 * retry / escalate-to-Flash / cancel / re-prioritise actions (admin RPCs in 0064). Reads
 * cross-org via the is_salt_admin() RLS added in 0062; writes go through the gated RPCs.
 */

// Rough Gemini-Flash cost per invoice for the cost meter — adjust to your real pricing.
const FLASH_COST_PAISE = 50; // ~₹0.50/call
const ONLINE_MS = 90_000; // a worker heartbeats every poll; stale beyond this = offline

interface AdminScanRow {
  id: string;
  org_id: string;
  original_filename: string | null;
  lane: ScanLane;
  status: ScanStatus;
  model: string | null;
  attempts: number;
  worker_id: string | null;
  invoice_no: string | null;
  vendor_guess: string | null;
  error: string | null;
  queued_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface WorkerRow {
  worker_id: string;
  hostname: string | null;
  model: string | null;
  status: string;
  jobs_done: number;
  last_seen_at: string;
}

function ageLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "0m";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function workerOnline(w: WorkerRow): boolean {
  return w.status !== "offline" && Date.now() - new Date(w.last_seen_at).getTime() < ONLINE_MS;
}

// Derive the dashboard metrics. Module-scope (not in render) so the time-based reads
// (now/age) don't trip the purity lint; the component re-derives via useMemo on refresh.
function computeMetrics(rows: AdminScanRow[]) {
  const pendingQueue = rows.filter((r) => r.status === "pending" && r.lane === "queue").length;
  const fetching = rows.filter(
    (r) => r.status === "processing" || r.status === "leased" || (r.status === "pending" && r.lane === "flash"),
  ).length;
  const oldestMs = rows
    .filter((r) => r.status === "pending" && r.lane === "queue" && r.queued_at)
    .reduce((min, r) => Math.min(min, new Date(r.queued_at as string).getTime()), Infinity);
  const hourAgo = Date.now() - 3_600_000;
  const donePerHr = rows.filter(
    (r) => r.completed_at && new Date(r.completed_at).getTime() >= hourAgo && ["extracted", "duplicate", "posted"].includes(r.status),
  ).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const succeeded = rows.filter((r) => ["extracted", "duplicate", "posted"].includes(r.status)).length;
  const failRate = failed + succeeded > 0 ? Math.round((100 * failed) / (failed + succeeded)) : 0;
  const flashCalls = rows.filter((r) => r.model === "flash").length;
  return {
    pendingQueue,
    fetching,
    oldestAge: oldestMs === Infinity ? "—" : ageLabel(new Date(oldestMs).toISOString()),
    donePerHr,
    failRate,
    flashCalls,
    estCostPaise: flashCalls * FLASH_COST_PAISE,
  };
}

export function OcrConsolePage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<AdminScanRow[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ScanStatus>("all");
  const [laneFilter, setLaneFilter] = useState<"all" | ScanLane>("all");

  // Admin gate (same pattern as the catalog submissions queue).
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supabase) {
        if (active) setIsAdmin(false);
        return;
      }
      const { data } = await supabase.rpc("is_salt_admin");
      if (active) setIsAdmin(data === true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Cross-org fetch of the queue + worker registry (admin RLS).
  useEffect(() => {
    if (!isAdmin || !supabase) return;
    let active = true;
    void (async () => {
      const [scansRes, workersRes] = await Promise.all([
        supabase
          .from("invoice_scans")
          .select("id,org_id,original_filename,lane,status,model,attempts,worker_id,invoice_no,vendor_guess,error,queued_at,completed_at,created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("ocr_workers").select("worker_id,hostname,model,status,jobs_done,last_seen_at"),
      ]);
      if (!active) return;
      setRows((scansRes.data as AdminScanRow[] | null) ?? []);
      setWorkers((workersRes.data as WorkerRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, reloadKey]);

  // Live refresh while anything is in flight (lease churn, fetches).
  const inFlight = rows.some((r) => r.status === "pending" || r.status === "processing" || r.status === "leased");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => setReloadKey((k) => k + 1), 5000);
    return () => clearInterval(t);
  }, [inFlight]);

  const metrics = useMemo(() => computeMetrics(rows), [rows]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) => (laneFilter === "all" ? true : r.lane === laneFilter))
      .slice()
      .sort((a, b) => {
        // Oldest pending first (worst lag on top); otherwise newest first.
        const ap = a.status === "pending" ? 0 : 1;
        const bp = b.status === "pending" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const at = new Date(a.queued_at ?? a.created_at).getTime();
        const bt = new Date(b.queued_at ?? b.created_at).getTime();
        return ap === 0 ? at - bt : bt - at;
      });
  }, [rows, statusFilter, laneFilter]);

  async function act(id: string, fn: string, extra?: Record<string, unknown>) {
    if (!supabase) return;
    setActingId(id);
    setErr(null);
    try {
      const { error } = await supabase.rpc(fn, { p_job_id: id, ...(extra ?? {}) });
      if (error) setErr(`${fn}: ${error.message}`);
      setReloadKey((k) => k + 1);
    } finally {
      setActingId(null);
    }
  }

  if (isAdmin === null) {
    return (
      <Page width="lg">
        <PageHeader icon={Activity} title="OCR console" />
        <p className="text-sm text-text-tertiary">Checking access…</p>
      </Page>
    );
  }
  if (!isAdmin) {
    return (
      <Page width="lg">
        <PageHeader icon={Activity} title="OCR console" />
        <div className="rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning">
          This console is for Salt admins only.
        </div>
      </Page>
    );
  }

  const onlineWorkers = workers.filter(workerOnline).length;
  const statuses: ("all" | ScanStatus)[] = ["all", "pending", "processing", "extracted", "failed", "duplicate", "posted", "superseded"];
  const lanes: ("all" | ScanLane)[] = ["all", "queue", "flash"];

  return (
    <Page width="lg">
      <PageHeader
        icon={Activity}
        title="OCR console"
        subtitle="Cross-tenant view of the two-lane invoice queue — worker health, throughput and Flash cost."
        actions={
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            <Loader2 className={inFlight ? "animate-spin" : ""} /> Refresh
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Queued (free)" value={metrics.pendingQueue} />
        <StatCard label="Fetching" value={metrics.fetching} />
        <StatCard label="Oldest lag" value={metrics.oldestAge} hint="vs ~6h TAT" />
        <StatCard label="Done / hr" value={metrics.donePerHr} />
        <StatCard label="Failure rate" value={`${metrics.failRate}%`} />
        <StatCard label="Flash calls" value={metrics.flashCalls} hint={`~${formatPaise(metrics.estCostPaise)} est.`} />
      </div>

      {/* Workers */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Server className="size-4 text-text-tertiary" /> Workers
          <span className="text-xs font-normal text-text-tertiary">
            {onlineWorkers}/{workers.length} online
          </span>
        </div>
        {workers.length === 0 ? (
          <p className="rounded-md border border-border bg-surface p-3 text-xs text-text-tertiary">
            No workers have registered yet. Start one: <code>cd workers/ocr-worker &amp;&amp; pnpm start</code>.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workers.map((w) => (
              <div key={w.worker_id} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium">
                  <span className={`inline-block size-2 rounded-full ${workerOnline(w) ? "bg-success" : "bg-text-tertiary"}`} />
                  {w.worker_id}
                </div>
                <div className="mt-0.5 text-text-tertiary">
                  {w.model ?? "?"} · {w.jobs_done} done · seen {ageLabel(w.last_seen_at)} ago
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-text-tertiary">Lane:</span>
        {lanes.map((l) => (
          <button
            key={l}
            onClick={() => setLaneFilter(l)}
            className={`rounded-full border px-2 py-0.5 ${laneFilter === l ? "border-primary text-primary" : "border-border text-text-tertiary"}`}
          >
            {l}
          </button>
        ))}
        <span className="ml-2 text-text-tertiary">Status:</span>
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-2 py-0.5 ${statusFilter === s ? "border-primary text-primary" : "border-border text-text-tertiary"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

      <DataTable<AdminScanRow>
        rows={filtered}
        rowKey={(r) => r.id}
        cols="1.4fr 0.7fr 1fr 0.6fr 0.9fr 1.6fr"
        loading={loading}
        empty={<EmptyState icon={Activity} title="No jobs" hint="Uploaded invoices will appear here as queue jobs." />}
        columns={[
          {
            key: "file",
            header: "Invoice / org",
            cell: (r) => (
              <div className="min-w-0">
                <div className="truncate">{r.invoice_no || r.original_filename || "invoice"}</div>
                <div className="truncate text-xs text-text-tertiary">{r.vendor_guess ?? r.org_id.slice(0, 8)}</div>
              </div>
            ),
          },
          {
            key: "lane",
            header: "Lane",
            cell: (r) => <Badge variant={r.lane === "flash" ? "warning" : "neutral"}>{r.lane}</Badge>,
          },
          { key: "status", header: "Status", cell: (r) => <Badge variant={scanStatusVariant(r.status)}>{scanStatusLabel(r.status, r.lane)}</Badge> },
          { key: "attempts", header: "Tries", cell: (r) => <span className="tabular-nums text-text-tertiary">{r.attempts}</span> },
          {
            key: "age",
            header: "Age",
            cell: (r) => (
              <span className="tabular-nums text-text-tertiary" title={format(new Date(r.created_at), "d MMM, HH:mm")}>
                {ageLabel(r.queued_at ?? r.created_at)}
                {r.worker_id ? <span className="ml-1 text-[0.65rem]">· {r.worker_id}</span> : null}
              </span>
            ),
          },
          {
            key: "actions",
            header: "",
            cell: (r) => {
              const busy = actingId === r.id;
              const terminal = ["extracted", "duplicate", "posted"].includes(r.status);
              return (
                <div className="flex items-center justify-end gap-2">
                  {r.status === "failed" && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act(r.id, "ocr_admin_retry")} title="Re-queue">
                      <RotateCcw /> Retry
                    </Button>
                  )}
                  {!terminal && r.lane === "queue" && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => act(r.id, "ocr_admin_escalate")} title="Escalate to Flash">
                        <Zap /> Flash
                      </Button>
                      {r.status === "pending" && (
                        <button
                          onClick={() => act(r.id, "ocr_admin_set_priority", { p_priority: 100 })}
                          disabled={busy}
                          className="text-text-tertiary hover:text-text-primary disabled:opacity-50"
                          title="Bump priority"
                          aria-label="Bump priority"
                        >
                          <ChevronUp className="size-4" />
                        </button>
                      )}
                    </>
                  )}
                  {!terminal && (
                    <button
                      onClick={() => act(r.id, "ocr_admin_cancel")}
                      disabled={busy}
                      className="text-text-tertiary hover:text-destructive disabled:opacity-50"
                      title="Cancel"
                      aria-label="Cancel job"
                    >
                      <Ban className="size-4" />
                    </button>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      <p className="mt-4 text-xs text-text-tertiary">
        Reads cross-tenant via <code>is_salt_admin()</code>. Worker setup:{" "}
        <Link to="/purchases/scans" className="text-primary hover:underline">
          scan history
        </Link>{" "}
        · <code>workers/ocr-worker/README.md</code>.
      </p>
    </Page>
  );
}
