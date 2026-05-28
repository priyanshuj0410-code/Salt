import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export function OnboardingPage() {
  const { session, membership, loading, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
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
    if (!supabase || !name.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("create_org", { p_name: name.trim() });
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">Set up your organization</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Name your business to get started. You’ll be its owner; staff can be added later.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="text"
            placeholder="e.g. Sharma Medical Store"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Organization name"
            autoFocus
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !name.trim()} className="w-full">
            {submitting ? "Creating…" : "Create organization"}
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
