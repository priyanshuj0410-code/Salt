import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { COPY } from "./copy";

/**
 * The "Invisible Auth" chat widget — the page's ONLY hero CTA. A named human
 * (Priyanshu) opens a conversation; the shop owner enters a 10-digit number,
 * we simulate a ~1s OTP send, then a 4-digit OTP auto-submits. On success we
 * call `onAuthenticated` so the parent can bloom into the app. This is a
 * SIMULATION — no Supabase call fires here; real auth lives at /login.
 *
 * One field + one action per state; disabled-until-valid submit; numeric
 * keypad on mobile; SMS autofill (autoComplete one-time-code); focus follows
 * the conversation; new bubbles are announced via aria-live.
 */
type Step = "number" | "otp";
interface Msg {
  id: number;
  role: "system" | "user";
  text: string;
}

let seq = 0;
const nextId = () => (seq += 1);

export function AuthChatWidget({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [step, setStep] = useState<Step>("number");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
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

  const phoneValid = phone.length === 10;
  const otpValid = otp.length === 4;

  function submitPhone() {
    if (!phoneValid || loading) return;
    setMessages((m) => [...m, { id: nextId(), role: "user", text: "+91 " + phone }]);
    setLoading(true);
    // ~1s simulated OTP send — a timeout in a handler (never a setState in an
    // effect body, which the Salt ESLint config forbids).
    window.setTimeout(() => {
      if (!alive.current) return;
      setLoading(false);
      setMessages((m) => [...m, { id: nextId(), role: "system", text: COPY.chatOtp }]);
      setStep("otp");
    }, 1000);
  }

  function finishOtp(code: string) {
    setMessages((m) => [...m, { id: nextId(), role: "user", text: code.replace(/./g, "•") }]);
    window.setTimeout(() => {
      if (alive.current) onAuthenticated();
    }, 420);
  }

  function onOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    setOtp(digits);
    if (digits.length === 4) finishOtp(digits); // auto-submit — no extra tap
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
            <Loader2 className="size-4 animate-spin" /> OTP bhej raha hoon…
          </div>
        )}
      </div>

      {/* Input — one field + one action per step */}
      {step === "number" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPhone();
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
              className="h-full w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
          <Button type="submit" size="icon" variant="primary" className="size-9 shrink-0" disabled={!phoneValid} aria-label="Send OTP">
            <ArrowRight />
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (otpValid) finishOtp(otp);
          }}
          className="flex items-center gap-2 border-t border-border px-3 py-3"
        >
          <input
            ref={otpRef}
            value={otp}
            onChange={(e) => onOtpChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="1234"
            aria-label="4-digit OTP"
            className="h-9 flex-1 rounded-lg border border-input bg-background text-center text-lg font-semibold tracking-[0.5em] text-text-primary outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-text-tertiary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" size="icon" variant="primary" className="size-9 shrink-0" disabled={!otpValid} aria-label="Verify OTP">
            <ArrowRight />
          </Button>
        </form>
      )}
    </Card>
  );
}
