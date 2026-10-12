import { useEffect, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  fetchMessages,
  postMessage,
  subscribeMessages,
  type EntityMessage,
} from "@/lib/messages";

/**
 * Reusable internal-message thread (SALT-105) for any entity — a bill, customer
 * or item. Drop it into a detail screen: `<MessageThread entityType="customer"
 * entityId={ledgerId} />`. Live across counters via the realtime substrate.
 */
export function MessageThread({
  entityType,
  entityId,
  className,
}: {
  entityType: string;
  entityId: string;
  className?: string;
}) {
  const { membership, user } = useAuth();
  const orgId = membership?.orgId;
  const [messages, setMessages] = useState<EntityMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    fetchMessages(orgId, entityType, entityId).then((rows) => {
      if (!active) return;
      setMessages(rows);
      setLoading(false);
    });
    const unsubscribe = subscribeMessages(orgId, entityType, entityId, (m) => {
      if (m.entity_type !== entityType) return; // defensive: entity_id filter only
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [orgId, entityType, entityId]);

  // Keep the latest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || !orgId || sending) return;
    setSending(true);
    setDraft("");
    const saved = await postMessage({ orgId, entityType, entityId, body });
    if (saved) {
      // Show immediately; the realtime echo is de-duped by id.
      setMessages((prev) => (prev.some((p) => p.id === saved.id) ? prev : [...prev, saved]));
    } else {
      setDraft(body); // restore on failure
    }
    setSending(false);
  }

  return (
    <div className={className}>
      <div className="max-h-72 min-h-24 space-y-2 overflow-y-auto px-0.5 py-1">
        {loading ? (
          <p className="py-6 text-center text-sm text-text-tertiary">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-text-tertiary">
            <MessageSquare className="size-5" />
            <p className="text-sm">No messages yet: start the thread.</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.author_id != null && m.author_id === user?.id;
            const when = new Date(m.created_at);
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm ${
                    mine ? "bg-primary text-primary-foreground" : "border border-border bg-surface"
                  }`}
                >
                  {m.body}
                </div>
                <div className="mt-0.5 px-1 text-[0.6875rem] text-text-tertiary">
                  {mine ? "You" : (m.author_name ?? "Counter")} ·{" "}
                  <time dateTime={when.toISOString()} title={format(when, "d MMM yyyy, HH:mm")}>
                    {formatDistanceToNow(when, { addSuffix: true })}
                  </time>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message your team…"
          className="h-9"
          disabled={sending}
        />
        <Button type="submit" size="sm" disabled={sending || draft.trim() === ""}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
