import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/**
 * Normalize free-form input to an E.164 phone number. A bare 10-digit number is
 * treated as an Indian mobile (+91, the primary market); a leading 0 is dropped;
 * an explicit "+<country>" is kept. Returns "" when there is nothing usable.
 */
function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return "+" + cleaned.slice(1).replace(/\D/g, "");
  const local = cleaned.replace(/\D/g, "").replace(/^0+/, "");
  if (local.length === 10) return "+91" + local; // bare Indian mobile
  return local ? "+" + local : "";
}
/** E.164: a leading + and 8–15 digits. */
function isValidPhone(e164: string): boolean {
  return /^\+\d{8,15}$/.test(e164);
}
function isSixDigit(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/**
 * Phone + SMS OTP sign-in (SALT-112). Two steps — enter number → enter the
 * 6-digit code — using Supabase `signInWithOtp` / `verifyOtp`. On success the
 * AuthProvider session listener redirects into the app.
 */
export function PhoneLogin({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"number" | "code">("number");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState(""); // normalized E.164 sent to Supabase
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const e164 = normalizePhone(phoneInput);
    if (!isValidPhone(e164)) {
      setError("Enter a valid phone number with country code, e.g. +91 98765 43210.");
      return;
    }
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) {
        setError(error.message);
      } else {
        setPhone(e164);
        setStep("code");
        setInfo(`We sent a 6-digit code to ${e164}.`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!isSixDigit(code)) {
      setError("Enter the 6-digit code we sent you.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: code.trim(), type: "sms" });
      if (error) setError(error.message);
      // success → AuthProvider's onAuthStateChange redirects via the session
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!supabase || !phone) return;
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) setError(error.message);
    else setInfo(`Code resent to ${phone}.`);
  }

  return (
    <div className="flex flex-col gap-3">
      {step === "number" ? (
        <form onSubmit={sendOtp} className="flex flex-col gap-3">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-emerald-600 dark:text-emerald-500">{info}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Sending…" : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
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
          {info && <p className="text-sm text-emerald-600 dark:text-emerald-500">{info}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Verifying…" : "Verify & sign in"}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep("number");
                setCode("");
                setError(null);
                setInfo(null);
              }}
              className="font-medium text-primary hover:underline"
            >
              Change number
            </button>
            <button
              type="button"
              onClick={resend}
              className="font-medium text-primary hover:underline"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm font-medium text-primary hover:underline"
      >
        ← Other sign-in options
      </button>
    </div>
  );
}
