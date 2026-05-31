import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Check, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/ui/dot";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { OnlineCounters } from "@/components/presence/OnlineCounters";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import {
  cancelApproval,
  decideApproval,
  fetchApprovals,
  requestApproval,
  subscribeApprovals,
  type ApprovalKind,
  type ApprovalRequest,
} from "@/lib/approvals";

const KINDS: { value: ApprovalKind; label: string }[] = [
  { value: "discount_override", label: "Discount" },
  { value: "credit_override", label: "Credit limit" },
  { value: "price_override", label: "Price" },
  { value: "return_auth", label: "Return" },
  { value: "void_bill", label: "Void bill" },
  { value: "other", label: "Other" },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

function useApprovals(orgId: string | undefined) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    fetchApprovals(orgId).then((rows) => {
      if (!active) return;
      setRequests(rows);
      setLoading(false);
    });
    const unsubscribe = subscribeApprovals(
      orgId,
      (r) =>
        setRequests((prev) => {
          const i = prev.findIndex((p) => p.id === r.id);
          if (i === -1) return [r, ...prev];
          const next = prev.slice();
          next[i] = r;
          return next;
        }),
      (connected) => {
        if (active) setLive(connected);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [orgId]);

  return { requests, loading, live, setRequests };
}

export function ApprovalsPage() {
  const { membership, user } = useAuth();
  const orgId = membership?.orgId;
  const isOwner = membership?.role === "owner";
  const { requests, loading, live, setRequests } = useApprovals(orgId);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upsert = (r: ApprovalRequest) =>
    setRequests((prev) => {
      const i = prev.findIndex((p) => p.id === r.id);
      if (i === -1) return [r, ...prev];
      const next = prev.slice();
      next[i] = r;
      return next;
    });

  const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const decided = useMemo(() => requests.filter((r) => r.status !== "pending").slice(0, 50), [requests]);

  async function act(id: string, fn: () => Promise<ApprovalRequest | null>) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await fn();
      if (updated) upsert(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page width="md">
      <PageHeader
        icon={ShieldCheck}
        title="Approvals"
        subtitle="Requests raised at the counter — approve or reject from any device, live"
        actions={
          <>
            <OnlineCounters />
            <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
              <Dot variant={live ? "success" : "warning"} pulse={live} />
              {live ? "Live" : "Connecting…"}
            </span>
            <Button type="button" size="sm" onClick={() => setRaiseOpen(true)}>
              <Plus className="size-4" /> Raise request
            </Button>
          </>
        }
      />

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="px-1 py-6 text-sm text-text-tertiary">Loading…</p>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No approval requests"
          hint="Raise one here, or wire the counter to request manager sign-off — it shows up live on every device."
        />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-xs font-medium tracking-wide text-text-tertiary uppercase">
              Pending{pending.length > 0 ? ` · ${pending.length}` : ""}
            </h2>
            {pending.length === 0 ? (
              <p className="rounded-md border border-border px-3 py-4 text-sm text-text-tertiary">
                Nothing waiting. New requests appear here instantly.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-md border border-border">
                {pending.map((r) => {
                  const when = new Date(r.created_at);
                  const mine = r.requested_by != null && r.requested_by === user?.id;
                  return (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-3 border-b border-divider px-3 py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge variant="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                          <span className="font-medium text-text-primary">{r.summary}</span>
                          {r.amount_paise != null && (
                            <span className="text-sm tabular-nums text-text-secondary">
                              {formatPaise(r.amount_paise)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-text-tertiary">
                          {r.requested_by_name ?? "Counter"} ·{" "}
                          <time dateTime={when.toISOString()} title={format(when, "d MMM yyyy, HH:mm")}>
                            {formatDistanceToNow(when, { addSuffix: true })}
                          </time>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isOwner && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, () => decideApproval(r.id, true))}
                            >
                              <Check className="size-4" /> Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={busyId === r.id}
                              onClick={() => act(r.id, () => decideApproval(r.id, false))}
                            >
                              <X className="size-4" /> Reject
                            </Button>
                          </>
                        )}
                        {mine && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busyId === r.id}
                            onClick={() => act(r.id, () => cancelApproval(r.id))}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {decided.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium tracking-wide text-text-tertiary uppercase">Decided</h2>
              <ul className="overflow-hidden rounded-md border border-border">
                {decided.map((r) => {
                  const when = new Date(r.decided_at ?? r.created_at);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 border-b border-divider px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <Badge variant="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                          <span className="min-w-0 truncate text-text-secondary">{r.summary}</span>
                          {r.amount_paise != null && (
                            <span className="tabular-nums text-text-tertiary">{formatPaise(r.amount_paise)}</span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-text-tertiary">
                          {r.decided_by_name ? `${r.decided_by_name} · ` : ""}
                          <time dateTime={when.toISOString()} title={format(when, "d MMM yyyy, HH:mm")}>
                            {formatDistanceToNow(when, { addSuffix: true })}
                          </time>
                        </div>
                      </div>
                      <Badge variant={STATUS_BADGE[r.status] ?? "neutral"} className="shrink-0 capitalize">
                        {r.status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      <RaiseApprovalDialog
        open={raiseOpen}
        onOpenChange={setRaiseOpen}
        onRaised={(r) => {
          upsert(r);
          setRaiseOpen(false);
        }}
        orgId={orgId}
      />
    </Page>
  );
}

function RaiseApprovalDialog({
  open,
  onOpenChange,
  onRaised,
  orgId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRaised: (r: ApprovalRequest) => void;
  orgId: string | undefined;
}) {
  const [kind, setKind] = useState<ApprovalKind>("discount_override");
  const [summary, setSummary] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!orgId || summary.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    const rupees = parseFloat(amount);
    try {
      const r = await requestApproval({
        orgId,
        kind,
        summary: summary.trim(),
        amountPaise: Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null,
      });
      if (r) {
        setSummary("");
        setAmount("");
        onRaised(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Raise approval request</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <Button
                key={k.value}
                type="button"
                size="sm"
                variant={kind === k.value ? "default" : "outline"}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </Button>
            ))}
          </div>
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What needs sign-off? e.g. 12% discount for Ramesh Medical"
            autoFocus
          />
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Amount ₹ (optional)"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || summary.trim() === ""}>
              {busy ? "Raising…" : "Raise request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
