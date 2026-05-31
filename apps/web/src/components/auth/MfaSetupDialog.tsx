import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

type Enrollment = { factorId: string; qrCode: string; secret: string };

/**
 * TOTP enrollment + management (SALT-113), opened from the owner's user menu.
 * Mounted only while open, so each open starts from a clean slate. Shows the
 * current state (on / off), enrolls a new factor (QR + secret → verify), and
 * can turn 2FA off. Half-finished unverified factors are pruned before a fresh
 * enrollment so re-enrolling is reliable.
 */
export function MfaSetupDialog({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load factor status on mount.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    void client.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setEnabled((data?.totp ?? []).length > 0);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  async function startEnroll() {
    if (!supabase) return;
    const client = supabase;
    setBusy(true);
    setError(null);
    try {
      // Prune any half-finished (unverified) factors so re-enrolling is clean.
      const { data: list } = await client.auth.mfa.listFactors();
      const stale = (list?.all ?? []).filter(
        (f) => f.factor_type === "totp" && f.status === "unverified",
      );
      await Promise.all(stale.map((f) => client.auth.mfa.unenroll({ factorId: f.id })));

      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp" });
      if (error || !data) {
        setError(error?.message ?? "Could not start enrollment.");
        return;
      }
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !enrollment) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollment.factorId,
        code: code.trim(),
      });
      if (error) {
        setError(error.message);
        return;
      }
      setEnabled(true);
      setEnrollment(null);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!supabase) return;
    const client = supabase;
    setBusy(true);
    setError(null);
    try {
      const { data: list } = await client.auth.mfa.listFactors();
      const totp = (list?.all ?? []).filter((f) => f.factor_type === "totp");
      await Promise.all(totp.map((f) => client.auth.mfa.unenroll({ factorId: f.id })));
      setEnabled(false);
      setEnrollment(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-factor authentication</DialogTitle>
          <DialogDescription>
            Protect the owner account with a time-based code from an authenticator app (Google
            Authenticator, Authy, 1Password).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : enabled ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-500">
              Two-factor authentication is on.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button type="button" variant="danger" onClick={disable} disabled={busy}>
                {busy ? "Working…" : "Turn off"}
              </Button>
            </DialogFooter>
          </div>
        ) : enrollment ? (
          <form onSubmit={confirmEnroll} className="flex flex-col gap-3">
            <img
              src={enrollment.qrCode}
              alt="Authenticator QR code"
              className="mx-auto size-44 rounded-lg border bg-white p-2"
            />
            <p className="text-center text-xs text-muted-foreground">
              Or enter this key manually:{" "}
              <code className="rounded bg-muted px-1 font-mono">{enrollment.secret}</code>
            </p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify & enable"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Two-factor authentication is off.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button type="button" onClick={startEnroll} disabled={busy}>
                {busy ? "Starting…" : "Enable"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
