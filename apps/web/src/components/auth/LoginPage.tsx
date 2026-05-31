import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

type Mode = "signin" | "signup" | "reset";

export function LoginPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If the session ended itself via idle auto-logout (SALT-115), say so once.
  // Deferred to a microtask (not a synchronous effect setState) and the flag is
  // cleared so the notice shows only on the visit right after the logout.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        if (sessionStorage.getItem("salt:idle-logout")) {
          sessionStorage.removeItem("salt:idle-logout");
          setInfo("You were signed out due to inactivity. Please sign in again.");
        }
      } catch {
        /* storage unavailable */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session) return <Navigate to="/" replace />;

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-background p-6 text-sm">
          <h1 className="mb-2 text-lg font-semibold">Salt</h1>
          <p className="text-muted-foreground">
            Supabase isn’t configured yet. Add{" "}
            <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code> to{" "}
            <code className="rounded bg-muted px-1">.env.local</code> and reload.
          </p>
        </div>
      </div>
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) setError(error.message);
        else if (!data.session)
          setInfo("Account created. Check your email to confirm, then sign in.");
      } else {
        // reset — send a recovery link back to the app
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) setError(error.message);
        else setInfo("If an account exists for that email, a password reset link is on its way.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!supabase) return;
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) setError(error.message);
    else setInfo("Confirmation email resent. Check your inbox.");
  }

  async function onGoogle() {
    if (!supabase) return;
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  const heading =
    mode === "signin"
      ? "Sign in to your shop"
      : mode === "signup"
        ? "Create your account"
        : "Reset your password";
  const submitLabel =
    mode === "signin" ? "Sign in" : mode === "signup" ? "Sign up" : "Send reset link";

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm">
        <div className="mb-5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Salt</h1>
          <p className="text-sm text-muted-foreground">{heading}</p>
        </div>

        {mode !== "reset" && (
          <>
            <Button variant="outline" className="w-full" onClick={onGoogle} type="button">
              <GoogleIcon />
              Continue with Google
            </Button>

            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <Input
              type="text"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          {mode !== "reset" && (
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
          )}

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => switchMode("reset")}
              className="-mt-1 self-end text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-emerald-600 dark:text-emerald-500">{info}</p>}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Please wait…" : submitLabel}
          </Button>
        </form>

        {mode === "signup" && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Didn’t get the confirmation email?{" "}
            <button
              type="button"
              onClick={onResend}
              className="font-medium text-primary hover:underline"
            >
              Resend
            </button>
          </p>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "reset" ? (
            <>
              Remembered it?{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => switchMode("signin")}
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              {mode === "signin" ? "New to Salt?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
