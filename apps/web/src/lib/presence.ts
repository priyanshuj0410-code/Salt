import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Live "who is at the counters right now" via Supabase Realtime **Presence**
 * (SALT-101). Each client tracks itself on a per-org presence channel; the hook
 * returns the de-duplicated set of online members (one entry per user).
 *
 * Presence is ephemeral (no table, no migration) — it rides the same Realtime
 * connection as the activity / messages / approvals channels.
 */
export interface PresenceMember {
  userId: string;
  name: string;
  role: string;
  online_at: string;
}

export function usePresence(
  orgId?: string,
  userId?: string,
  name?: string,
  role?: string,
): PresenceMember[] {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  useEffect(() => {
    const sb = supabase;
    if (!sb || !orgId || !userId) return;
    const self: PresenceMember = {
      userId,
      name: name ?? "Counter",
      role: role ?? "",
      online_at: new Date().toISOString(),
    };
    const channel = sb.channel(`presence:${orgId}`, { config: { presence: { key: userId } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMember>();
        setMembers(
          Object.values(state)
            .map((entries) => entries[0])
            .filter((m): m is PresenceMember & { presence_ref: string } => Boolean(m)),
        );
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track(self);
      });
    return () => {
      void sb.removeChannel(channel);
    };
  }, [orgId, userId, name, role]);

  return members;
}
