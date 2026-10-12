import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Receipt, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { SetupChecklist } from "@/components/onboarding/SetupChecklist";
import { LicenseRenewalBanner } from "@/components/owner/LicenseRenewalBanner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface Invite {
  code: string;
  role: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

function inviteStatus(inv: Invite): { label: string; variant: "secondary" | "outline" | "destructive" } {
  if (inv.used_at) return { label: "used", variant: "secondary" };
  if (new Date(inv.expires_at) < new Date()) return { label: "expired", variant: "destructive" };
  return { label: "active", variant: "outline" };
}

async function fetchInvites(orgId: string): Promise<Invite[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("invites")
    .select("code,role,created_at,expires_at,used_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  return (data as Invite[] | null) ?? [];
}

export function OwnerHome() {
  const orgId = useAuth().membership?.orgId;
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    fetchInvites(orgId).then((rows) => {
      if (active) setInvites(rows);
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  async function generate() {
    if (!supabase || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("create_invite", { p_role: "cashier" });
      if (err) setError(err.message);
      else setInvites(await fetchInvites(orgId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="sm">
        <SetupChecklist />
        <h1 className="text-xl font-semibold">Owner dashboard</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Reporting and inventory health will live here. For now, manage your team.
        </p>

        <LicenseRenewalBanner />

        <Link
          to="/parties"
          className="mt-5 flex items-center justify-between rounded-lg border p-4 hover:bg-surface"
        >
          <div className="flex items-center gap-3">
            <Users className="size-5 text-primary" />
            <div>
              <h2 className="text-sm font-medium">Parties</h2>
              <p className="text-xs text-text-tertiary">
                Customers and vendors, balances, re-tagging and merging duplicates.
              </p>
            </div>
          </div>
          <span className="text-text-tertiary">→</span>
        </Link>

        <Link
          to="/bills"
          className="mt-3 flex items-center justify-between rounded-lg border p-4 hover:bg-surface"
        >
          <div className="flex items-center gap-3">
            <Receipt className="size-5 text-primary" />
            <div>
              <h2 className="text-sm font-medium">Bills</h2>
              <p className="text-xs text-text-tertiary">
                Every saved sale, with customer, payment and totals.
              </p>
            </div>
          </div>
          <span className="text-text-tertiary">→</span>
        </Link>

        <div className="mt-5 rounded-lg border">
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <h2 className="text-sm font-medium">Cashiers</h2>
              <p className="text-xs text-text-tertiary">
                Generate a code and share it with a cashier. They enter it when they sign up.
              </p>
            </div>
            <Button onClick={generate} disabled={busy}>
              <UserPlus />
              {busy ? "Generating…" : "Invite cashier"}
            </Button>
          </div>

          {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}

          {invites.length === 0 ? (
            <p className="p-4 text-sm text-text-tertiary">No invites yet.</p>
          ) : (
            <ul className="divide-y">
              {invites.map((inv) => {
                const status = inviteStatus(inv);
                return (
                  <li key={inv.code} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-mono font-medium tracking-widest">{inv.code}</span>
                    <Badge variant="secondary">{inv.role}</Badge>
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="flex-1" />
                    {status.label === "active" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy code"
                        onClick={() => navigator.clipboard.writeText(inv.code)}
                      >
                        <Copy />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link to="/" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
          ← Go to billing
        </Link>
    </Page>
  );
}
