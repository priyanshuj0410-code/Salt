import { useEffect, useState } from "react";
import { ShieldCheck, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { supabase } from "@/lib/supabase";
import { useAuth, type UserRole } from "@/lib/auth";
import {
  MODULES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_MODULES,
  ROLES,
  can,
  type ModuleKey,
  type PermissionOverrides,
} from "@/lib/permissions";

interface Member {
  user_id: string;
  role: UserRole;
  permissions: PermissionOverrides | null;
  full_name: string | null;
  email: string | null;
  is_self: boolean;
  created_at: string;
}

function rpcError(msg: string): string {
  if (/function|does not exist|not find|schema cache/i.test(msg)) {
    return "Roles aren't installed yet — run supabase/migrations/0046_roles_permissions.sql, then retry.";
  }
  return msg;
}

const selectCls =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:border-ring";

/** Settings → Roles & permissions. Owner assigns roles + per-user overrides (SALT-091). */
export function UsersRolesPage() {
  const { refresh } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.rpc("org_members").then(({ data, error: err }) => {
      if (!active) return;
      if (err) setError(rpcError(err.message));
      else setMembers((data as Member[] | null) ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <Page width="lg">
      <PageHeader
        icon={ShieldCheck}
        title="Roles & permissions"
        subtitle="Assign each team member a role, and fine-tune access per person."
      />

      <p className="mb-4 text-sm text-text-secondary">
        A role grants a default set of modules; per-user overrides add or remove specific areas on
        top. The last owner can&apos;t be demoted.
      </p>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : members.length === 0 && !error ? (
        <p className="text-sm text-text-tertiary">No members found.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-divider">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.full_name || m.email || "Member"}</span>
                    {m.is_self && <Badge variant="neutral">You</Badge>}
                  </div>
                  {m.email && m.full_name && (
                    <div className="truncate text-xs text-text-tertiary">{m.email}</div>
                  )}
                </div>
                <Badge variant={m.role === "owner" ? "strong" : "secondary"}>{ROLE_LABELS[m.role]}</Badge>
                <Button variant="outline" size="sm" onClick={() => setEditing(m)}>
                  <UserCog /> Manage
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <MemberEditor
              key={editing.user_id}
              member={editing}
              onDone={async (changedSelf) => {
                setEditing(null);
                if (changedSelf) await refresh();
                setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function MemberEditor({
  member,
  onDone,
  onCancel,
}: {
  member: Member;
  onDone: (changedSelf: boolean) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<UserRole>(member.role);
  const [perms, setPerms] = useState<PermissionOverrides>(member.permissions ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(mod: ModuleKey, desired: boolean) {
    const grant = new Set(perms.grant ?? []);
    const revoke = new Set(perms.revoke ?? []);
    grant.delete(mod);
    revoke.delete(mod);
    const roleDefault = ROLE_MODULES[role].includes(mod);
    if (desired !== roleDefault) {
      if (desired) grant.add(mod);
      else revoke.add(mod);
    }
    setPerms({ grant: [...grant], revoke: [...revoke] });
  }

  async function save() {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("set_member_role", {
        p_user_id: member.user_id,
        p_role: role,
        p_permissions: perms,
      });
      if (err) {
        setError(rpcError(err.message));
        return;
      }
      onDone(member.is_self);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{member.full_name || member.email || "Member"}</DialogTitle>
        <DialogDescription>Set this person&apos;s role and fine-tune their access.</DialogDescription>
      </DialogHeader>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={selectCls}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
      </label>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Access</div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {MODULES.map((mod) => {
            const allowed = can(role, perms, mod.key);
            const isDefault = ROLE_MODULES[role].includes(mod.key);
            const overridden = allowed !== isDefault;
            return (
              <label key={mod.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(e) => toggle(mod.key, e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span>{mod.label}</span>
                {overridden && <span className="text-[10px] text-warning">override</span>}
              </label>
            );
          })}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
