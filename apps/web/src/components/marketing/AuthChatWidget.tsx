import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { COPY } from "./copy";

/**
 * The "Invisible Auth" chat widget — the page's only hero CTA. A named human
 * (Priyanshu) opens a conversation; the shop owner enters a 10-digit number, we
 * send a REAL Supabase SMS OTP (signInWithOtp) and verify the 6-digit code
 * (verifyOtp). On success a session is live and we call onAuthenticated so the
 * page can bloom into the app; "Enter Salt" then lands on "/".
 *
 * If SMS is not configured on the project (no phone provider / signups off, or
 * no Supabase client), we fall back to a clearly-labelled DEMO so the marketing
 * funnel still shows the product — any 6-digit code advances the morph, and the
 * page auto-upgrades to real OTP the moment Phone auth is enabled in Supabase.
 */
type Step = "number" | "otp";
interface Msg {
  id: number;
  role: "system" | "user";
  text: string;
}

const RESEND_COOLDOWN = 30; // seconds; Supabase also rate-limits server-side
const DEMO_PROMPT = "Live SMS abhi set ho raha hai — demo dekhne ke liye koi bhi 6-digit code daalein.";

let seq = 0;
const nextId = () => (seq += 1);

/** True when the failure means SMS just is not wired up on this project. */
function smsUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("provider") ||
    m.includes("disabled") ||
    m.includes("not enabled") ||
    m.includes("unsupported") ||
    m.includes("signups")
  );
}

/** Map remaining Supabase auth errors to a calm Hinglish line (never leak internals). */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate") || m.includes("limit") || m.includes("seconds"))
    return "Thodi der ruk kar dobara bhejein.";
  if (m.includes("invalid") && m.includes("phone"))
    return "Yeh number theek nahi lag raha. Dobara check karein.";
  if (m.includes("token") || m.includes("otp") || m.includes("expired"))
    return "OTP galat ya purana ho gaya. Naya OTP mangwaein.";
  return "Kuch dikkat aa gayi. Dobara try karein.";
}

export function AuthChatWidget({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [step, setStep] = useState<Step>("number");
  const [phone, setPhone] = useState(""); // 10 local digits
  const [phoneE164, setPhoneE164] = useState(""); // the number we actually texted
  const [demo, setDemo] = useState(false); // SMS not configured → labelled demo
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [resendNonce, setResendNonce] = useState(0);
  const [messages, setMessages] = useState<Msg[]>([
    { id: nextId(), role: "system", text: COPY.chatGreeting },
  ]);

  const numberRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  // Focus follows the conversation; keep the newest bubble in view.
  useEffect(() => {
    (step === "number" ? numberRef : otpRef).current?.focus();
  }, [step]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Resend cooldown ticker — the seed is set in the handler (never a setState in
  // the effect body, which the Salt ESLint config forbids); this only decrements.
  useEffect(() => {
    if (resendNonce === 0) return;
    const id = window.setInterval(() => {
      setResendIn((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendNonce]);

  function startCooldown() {
    setResendIn(RESEND_COOLDOWN);
    setResendNonce((n) => n + 1);
  }

  const pushSys = (text: string) => setMessages((m) => [...m, { id: nextId(), role: "system", text }]);
  const pushUser = (text: string) => setMessages((m) => [...m, { id: nextId(), role: "user", text }]);

  const phoneValid = phone.length === 10;
  const otpValid = otp.length === 6;

  /** SMS is not wired up on this project — advance to a labelled demo of the flow. */
  function enterDemo(e164: string) {
    setDemo(true);
    setPhoneE164(e164);
    setStep("otp");
    pushSys(DEMO_PROMPT);
    startCooldown();
  }

  async function sendOtp() {
    if (!phoneValid || loading) return;
    const e164 = "+91" + phone;
    pushUser("+91 " + phone);
    setLoadingText("OTP bhej raha hoon…");
    setLoading(true);
    if (!supabase) {
      setLoading(false);
      enterDemo(e164); // no client configured at all
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
    if (!alive.current) return;
    setLoading(false);
    if (error) {
      if (smsUnavailable(error.message)) {
        enterDemo(e164); // provider not enabled → demo, not a dead end
        return;
      }
      pushSys(friendlyError(error.message));
      return; // stay on the number step
    }
    setPhoneE164(e164);
    setStep("otp");
    pushSys(COPY.chatOtp);
    startCooldown();
  }

  async function verify(code: string) {
    if (loading) return;
    pushUser(code.replace(/./g, "•"));
    setOtp("");
    setLoadingText(demo ? "Salt khol raha hoon…" : "Verify kar raha hoon…");
    setLoading(true);
    if (demo || !supabase) {
      setLoading(false);
      window.setTimeout(() => {
        if (alive.current) onAuthenticated(); // demo: any 6 digits show the app
      }, 320);
      return;
    }
    const { error } = await supabase.auth.verifyOtp({ phone: phoneE164, token: code, type: "sms" });
    if (!alive.current) return;
    setLoading(false);
    if (error) {
      pushSys(friendlyError(error.message));
      otpRef.current?.focus();
      return;
    }
    // Session is live — bloom into the app.
    window.setTimeout(() => {
      if (alive.current) onAuthenticated();
    }, 320);
  }

  function onOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setOtp(digits);
    if (digits.length === 6) verify(digits); // auto-submit — no extra tap
  }

  async function resend() {
    if (resendIn > 0 || loading) return;
    if (demo) {
      pushSys("Demo mode — koi bhi 6-digit code chalega.");
      startCooldown();
      return;
    }
    if (!supabase || !phoneE164) return;
    setLoadingText("Naya OTP bhej raha hoon…");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
    if (!alive.current) return;
    setLoading(false);
    if (error) pushSys(friendlyError(error.message));
    else {
      pushSys("Naya OTP bhej diya.");
      startCooldown();
    }
  }

  function editNumber() {
    setStep("number");
    setOtp("");
    setDemo(false);
  }

  return (
    <Card className="w-[min(92vw,380px)] gap-0 py-0 shadow-2xl">
      {/* Header — the named human */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          P
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">Priyanshu</div>
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <span className="size-1.5 rounded-full bg-success" /> Salt · abhi online
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div
        ref={scrollRef}
        aria-live="polite"
        className="flex max-h-[42vh] min-h-[7.5rem] flex-col gap-2 overflow-y-auto px-4 py-3"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              "max-w-[85%] animate-in fade-in slide-in-from-bottom-1 rounded-2xl px-3 py-2 text-sm duration-200 " +
              (m.role === "user"
                ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                : "self-start rounded-bl-sm bg-surface-2 text-text-primary")
            }
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="flex max-w-[85%] items-center gap-2 self-start rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-tertiary">
            <Loader2 className="size-4 animate-spin" /> {loadingText}
          </div>
        )}
      </div>

      {/* Input — one field + one action per step */}
      {step === "number" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendOtp();
          }}
          className="flex items-center gap-2 border-t border-border px-3 py-3"
        >
          <div className="flex h-9 flex-1 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <span className="text-sm text-text-tertiary">+91</span>
            <input
              ref={numberRef}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              autoComplete="tel"
              pattern="[0-9]*"
              placeholder="98765 43210"
              aria-label="Mobile number"
              disabled={loading}
              className="h-full w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-60"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            variant="primary"
            className="size-9 shrink-0"
            disabled={!phoneValid || loading}
            aria-label="Send OTP"
          >
            <ArrowRight />
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (otpValid) verify(otp);
            }}
            className="flex items-center gap-2"
          >
            <input
              ref={otpRef}
              value={otp}
              onChange={(e) => onOtpChange(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              aria-label="6-digit OTP"
              disabled={loading}
              className="h-9 flex-1 rounded-lg border border-input bg-background text-center text-lg font-semibold tracking-[0.3em] text-text-primary outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-text-tertiary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            />
            <Button
              type="submit"
              size="icon"
              variant="primary"
              className="size-9 shrink-0"
              disabled={!otpValid || loading}
              aria-label="Verify OTP"
            >
              <ArrowRight />
            </Button>
          </form>
          <div className="flex items-center justify-between px-0.5 text-xs">
            <button
              type="button"
              onClick={editNumber}
              disabled={loading}
              className="font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50"
            >
              Number badlein
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={resendIn > 0 || loading}
              className="font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendIn > 0 ? `Dobara bhejein (${resendIn}s)` : "OTP dobara bhejein"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
