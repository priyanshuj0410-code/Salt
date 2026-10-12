import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow, isToday } from "date-fns";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare,
  Receipt,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot } from "@/components/ui/dot";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { MessageThread } from "@/components/messages/MessageThread";
import { OnlineCounters } from "@/components/presence/OnlineCounters";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { fetchRecentActivity, subscribeActivity, type ActivityEvent } from "@/lib/activity";

/** Per-kind presentation: icon, amount tone, and the sign shown before money. */
const KIND_META: Record<
  string,
  { Icon: LucideIcon; tone: "success" | "danger" | "muted"; sign: "+" | "-" | "" }
> = {
  sale: { Icon: Receipt, tone: "success", sign: "+" },
  payment_in: { Icon: ArrowDownLeft, tone: "success", sign: "+" },
  payment_out: { Icon: ArrowUpRight, tone: "danger", sign: "-" },
  purchase: { Icon: ShoppingCart, tone: "muted", sign: "-" },
};

const FALLBACK_META = { Icon: Activity, tone: "muted" as const, sign: "" as const };

const TONE_CLASS = {
  success: "text-success",
  danger: "text-danger",
  muted: "text-text-tertiary",
} as const;

type KindFilter = "all" | "sale" | "purchase" | "payment";

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
  { value: "payment", label: "Payments" },
];

function matchesKind(filter: KindFilter, kind: string): boolean {
  if (filter === "all") return true;
  if (filter === "payment") return kind === "payment_in" || kind === "payment_out";
  return kind === filter;
}

/** Initial fetch + live subscription, de-duped and capped. */
function useActivityFeed(orgId: string | undefined) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    fetchRecentActivity(orgId).then((rows) => {
      if (!active) return;
      setEvents(rows);
      setLoading(false);
    });
    const unsubscribe = subscribeActivity(
      orgId,
      (e) =>
        setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev]).slice(0, 500)),
      (connected) => {
        if (active) setLive(connected);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [orgId]);

  return { events, loading, live };
}

export function ActivityPage() {
  const orgId = useAuth().membership?.orgId;
  const { events, loading, live } = useActivityFeed(orgId);
  const [kind, setKind] = useState<KindFilter>("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [q, setQ] = useState("");
  const [openEvent, setOpenEvent] = useState<ActivityEvent | null>(null);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (!matchesKind(kind, e.kind)) return false;
      if (todayOnly && !isToday(new Date(e.created_at))) return false;
      if (needle) {
        const hay = `${e.title} ${e.party_name ?? ""} ${e.actor_name ?? ""} ${e.ref ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [events, kind, todayOnly, q]);

  return (
    <Page width="md">
      <PageHeader
        icon={Activity}
        title="Activity"
        subtitle="Every sale, payment and GRN across all counters, live"
        actions={
          <>
            <OnlineCounters />
            <span className="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
              <Dot variant={live ? "success" : "warning"} />
              {live ? "Live" : "Connecting…"}
            </span>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {KIND_FILTERS.map((f) => (
            <Button
              key={f.value}
              type="button"
              size="sm"
              variant={kind === f.value ? "default" : "outline"}
              onClick={() => setKind(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant={todayOnly ? "default" : "outline"}
          onClick={() => setTodayOnly((v) => !v)}
        >
          Today
        </Button>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search party, counter or reference…"
          className="h-9 max-w-xs"
        />
      </div>

      {loading ? (
        <p className="px-1 py-6 text-sm text-text-tertiary">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={events.length === 0 ? "No activity yet" : "Nothing matches"}
          hint={
            events.length === 0
              ? "Save a bill, record a payment or receive stock. It shows up here instantly, on every counter."
              : "Try a different filter or search."
          }
        />
      ) : (
        <ol className="overflow-hidden rounded-md border border-border">
          {visible.map((e) => {
            const meta = KIND_META[e.kind] ?? FALLBACK_META;
            const Icon = meta.Icon;
            const when = new Date(e.created_at);
            return (
              <li key={e.id} className="border-b border-divider last:border-b-0">
                <button
                  type="button"
                  onClick={() => e.entity_id && setOpenEvent(e)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-surface">
                    <Icon className={`size-4 ${TONE_CLASS[meta.tone]}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 text-sm">
                      <span className="font-medium text-text-primary">{e.title}</span>
                      {e.party_name && (
                        <span className="min-w-0 truncate text-text-secondary">· {e.party_name}</span>
                      )}
                      {e.ref && <span className="shrink-0 text-xs text-text-tertiary">{e.ref}</span>}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {e.actor_name ?? "Counter"} ·{" "}
                      <time dateTime={when.toISOString()} title={format(when, "d MMM yyyy, HH:mm")}>
                        {formatDistanceToNow(when, { addSuffix: true })}
                      </time>
                    </div>
                  </div>
                  {e.amount_paise != null && (
                    <span className={`shrink-0 text-sm tabular-nums ${TONE_CLASS[meta.tone]}`}>
                      {meta.sign}
                      {formatPaise(e.amount_paise)}
                    </span>
                  )}
                  <MessageSquare className="size-3.5 shrink-0 text-text-tertiary" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <Dialog open={openEvent !== null} onOpenChange={(o) => !o && setOpenEvent(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-4 text-text-tertiary" />
              {openEvent
                ? [openEvent.title, openEvent.party_name, openEvent.ref].filter(Boolean).join(" · ")
                : "Thread"}
            </DialogTitle>
          </DialogHeader>
          {openEvent?.entity_id && (
            <MessageThread entityType={openEvent.entity_type ?? ""} entityId={openEvent.entity_id} />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
