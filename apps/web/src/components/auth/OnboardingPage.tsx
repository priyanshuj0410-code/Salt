import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export function OnboardingPage() {
  const { session, membership, loading, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (membership) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error } =
        mode === "create"
          ? await supabase.rpc("create_org", { p_name: name.trim() })
          : await supabase.rpc("redeem_invite", { p_code: code.trim() });
      if (error) {
        setError(error.message);
        return;
      }
      await refresh();
      navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = mode === "create" ? name.trim().length > 0 : code.trim().length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => { setMode("create"); setError(null); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "create" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Create org
          </button>
          <button
            type="button"
            onClick={() => { setMode("join"); setError(null); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "join" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Join with code
          </button>
        </div>

        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "create" ? "Set up your organization" : "Join your team"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "create"
              ? "Name your business to get started. You’ll be its owner."
              : "Enter the invite code your owner shared with you."}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {mode === "create" ? (
            <Input
              type="text"
              placeholder="e.g. Sharma Medical Store"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Organization name"
              autoFocus
            />
          ) : (
            <Input
              type="text"
              placeholder="e.g. A1B2C3D4"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-label="Invite code"
              autoFocus
              className="font-mono tracking-widest"
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !canSubmit} className="w-full">
            {submitting
              ? "Please wait…"
              : mode === "create"
                ? "Create organization"
                : "Join organization"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Signed in as {session.user.email} ·{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => signOut()}>
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}
