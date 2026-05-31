import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { usePresence } from "@/lib/presence";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * "Who is online at the counters" — live avatars + count via Supabase Presence
 * (SALT-101). Reusable; rendered in the header of the realtime surfaces and
 * droppable into the global app shell (handoff for the nav module).
 */
export function OnlineCounters({ className }: { className?: string }) {
  const { membership, user } = useAuth();
  const name =
    (user?.user_metadata as { full_name?: string } | undefined)?.full_name ?? user?.email ?? "Counter";
  const members = usePresence(membership?.orgId, user?.id, name, membership?.role);

  if (members.length === 0) return null;
  const shown = members.slice(0, 4);
  const extra = members.length - shown.length;

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={`${members.length} online · ${members.map((m) => m.name).join(", ")}`}
    >
      <span className="flex -space-x-1.5">
        {shown.map((m) => (
          <span
            key={m.userId}
            className="grid size-6 place-items-center rounded-full border border-border bg-surface-2 text-[0.625rem] font-medium text-text-secondary"
          >
            {initials(m.name)}
          </span>
        ))}
        {extra > 0 && (
          <span className="grid size-6 place-items-center rounded-full border border-border bg-surface-2 text-[0.625rem] font-medium text-text-tertiary">
            +{extra}
          </span>
        )}
      </span>
      <span className="text-xs text-text-tertiary">{members.length} online</span>
    </span>
  );
}
