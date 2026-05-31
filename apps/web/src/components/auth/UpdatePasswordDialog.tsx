import { useState } from "react";
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

/** New-password validation: at least 8 chars and the confirmation must match. */
function passwordError(password: string, confirm: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

/**
 * Modal shown after a user returns via a password-recovery link (SALT-114).
 * AuthProvider renders it app-wide when the PASSWORD_RECOVERY auth event fires;
 * on save the recovery session is upgraded and the user stays signed in.
 */
export function UpdatePasswordDialog({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const invalid = passwordError(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(error.message);
      else onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>
            Choose a new password for your account. You will stay signed in once it is saved.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
