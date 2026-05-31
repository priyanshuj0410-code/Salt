import { supabase } from "./supabase";
import { subscribeTableChanges } from "./realtime";

/**
 * Approve-from-manager-device (SALT-106) — data + real-time layer.
 *
 * A cashier raises a request; an owner approves/rejects from another device; the
 * decision flows back live. Rides the shared per-org Postgres-changes substrate,
 * subscribed for INSERT *and* UPDATE so status changes propagate. Decisions go
 * through SECURITY DEFINER RPCs (owner-only / requester-only), never direct UPDATE.
 */

export type ApprovalKind =
  | "discount_override"
  | "credit_override"
  | "price_override"
  | "return_auth"
  | "void_bill"
  | "other";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest {
  id: string;
  org_id: string;
  kind: string;
  summary: string;
  amount_paise: number | null;
  context: Record<string, unknown>;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
}

const COLS =
  "id,org_id,kind,summary,amount_paise,context,status,requested_by,requested_by_name,decided_by,decided_by_name,decided_at,created_at";

/** Newest-first window of requests (pending + recently decided). */
export async function fetchApprovals(orgId: string, limit = 100): Promise<ApprovalRequest[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("approval_requests")
    .select(COLS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ApprovalRequest[] | null) ?? [];
}

/** Raise a request. requested_by is stamped server-side; status forced pending. */
export async function requestApproval(input: {
  orgId: string;
  kind: ApprovalKind;
  summary: string;
  amountPaise?: number | null;
  context?: Record<string, unknown>;
}): Promise<ApprovalRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("approval_requests")
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      summary: input.summary,
      amount_paise: input.amountPaise ?? null,
      context: input.context ?? {},
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return (data as ApprovalRequest | null) ?? null;
}

/** Owner-only decision (enforced in the RPC). */
export async function decideApproval(id: string, approved: boolean): Promise<ApprovalRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("decide_approval_request", {
    p_id: id,
    p_approved: approved,
  });
  if (error) throw error;
  return (data as ApprovalRequest | null) ?? null;
}

/** Requester-only cancel of a still-pending request (enforced in the RPC). */
export async function cancelApproval(id: string): Promise<ApprovalRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("cancel_approval_request", { p_id: id });
  if (error) throw error;
  return (data as ApprovalRequest | null) ?? null;
}

/** Live INSERTs + UPDATEs for an org's requests. */
export function subscribeApprovals(
  orgId: string,
  onChange: (r: ApprovalRequest) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  return subscribeTableChanges<ApprovalRequest>({
    channel: `approvals:${orgId}`,
    table: "approval_requests",
    filter: `org_id=eq.${orgId}`,
    event: "*",
    onChange: (row) => onChange(row),
    onStatus,
  });
}
