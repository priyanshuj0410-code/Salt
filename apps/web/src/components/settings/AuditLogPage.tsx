import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { History, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface AuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string | null;
  row_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
}

interface ProfileLite {
  id: string;
  full_name: string | null;
  email: string | null;
}

const SELECT = "id,user_id,action,table_name,row_id,before,after,created_at";
const PAGE_LIMIT = 200;

type Variant = "success" | "info" | "danger" | "neutral";
const actionVariant = (a: string): Variant =>
  a === "insert" ? "success" : a === "update" ? "info" : a === "delete" ? "danger" : "neutral";

const ACTIONS = ["all", "insert", "update", "delete", "custom"] as const;
type ActionFilter = (typeof ACTIONS)[number];

/** Settings → Audit log. Read-only, append-only trail of changes (UI-immutable). */
export function AuditLogPage() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [users, setUsers] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionFilter>("all");
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select(SELECT)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (!active) return;
      const entries = (data as AuditEntry[] | null) ?? [];
      setRows(entries);
      setLoading(false);

      // Resolve the actors in a second pass (no direct FK to embed).
      const ids = [...new Set(entries.map((e) => e.user_id).filter((x): x is string => !!x))];
      if (ids.length && supabase) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", ids);
        if (!active) return;
        const map: Record<string, ProfileLite> = {};
        for (const p of (profs as ProfileLite[] | null) ?? []) map[p.id] = p;
        setUsers(map);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.action === filter)),
    [rows, filter],
  );

  const who = (id: string | null) => {
    if (!id) return "System";
    const p = users[id];
    return p?.full_name || p?.email || `${id.slice(0, 8)}…`;
  };

  return (
    <Page width="lg">
      <PageHeader
        icon={History}
        title="Audit log"
        subtitle="A read-only trail of changes across your organisation."
        actions={
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ActionFilter)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:border-ring"
            aria-label="Filter by action"
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === "all" ? "All actions" : a[0].toUpperCase() + a.slice(1)}
              </option>
            ))}
          </select>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-secondary">
        <Lock className="mt-0.5 size-4 shrink-0 text-text-tertiary" />
        <span>
          Audit entries are <span className="font-medium text-text-primary">append-only</span> — they
          cannot be edited or deleted from here. Showing the latest {PAGE_LIMIT} entries.
        </span>
      </div>

      <DataTable<AuditEntry>
        rows={filtered}
        rowKey={(e) => e.id}
        cols="1.1fr 0.7fr 1fr 1fr 0.8fr"
        onRowActivate={(e) => setDetail(e)}
        loading={loading}
        empty={
          <EmptyState
            icon={History}
            title={rows.length === 0 ? "No audit entries yet" : "Nothing matches this filter"}
            hint={
              rows.length === 0
                ? "Entries appear here as changes are recorded once audit capture is enabled."
                : "Try a different action filter."
            }
          />
        }
        columns={[
          {
            key: "when",
            header: "When",
            cell: (e) => (
              <span className="text-text-tertiary">{format(parseISO(e.created_at), "d MMM yyyy, h:mm a")}</span>
            ),
          },
          { key: "action", header: "Action", cell: (e) => <Badge variant={actionVariant(e.action)}>{e.action}</Badge> },
          {
            key: "table",
            header: "Table",
            cell: (e) => e.table_name ?? <span className="text-text-tertiary">—</span>,
          },
          {
            key: "who",
            header: "By",
            cell: (e) => <span className="truncate">{who(e.user_id)}</span>,
          },
          {
            key: "row",
            header: "Row",
            cell: (e) => (
              <span className="font-mono text-xs text-text-tertiary">
                {e.row_id ? `${e.row_id.slice(0, 8)}…` : "—"}
              </span>
            ),
          },
        ]}
      />

      <Dialog open={detail != null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant={actionVariant(detail.action)}>{detail.action}</Badge>
                  <span className="font-mono text-sm">{detail.table_name ?? "—"}</span>
                </DialogTitle>
                <DialogDescription>
                  {format(parseISO(detail.created_at), "d MMM yyyy, h:mm a")} · by {who(detail.user_id)}
                  {detail.row_id ? ` · row ${detail.row_id.slice(0, 8)}…` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <JsonBlock label="Before" value={detail.before} />
                <JsonBlock label="After" value={detail.after} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {value == null ? (
        <p className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm text-text-tertiary">—</p>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
