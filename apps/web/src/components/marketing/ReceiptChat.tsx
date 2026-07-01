import { useEffect, useRef, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { COPY } from "./copy";

/**
 * The invisible-onboarding chat — the page's only hero CTA. Priyanshu asks for a
 * bill/receipt photo; the shop owner uploads one; we (demo-)parse it and call
 * onParsed so the page blooms straight into the dashboard. No phone/OTP here —
 * real auth lives at /login, reachable via "skip" (onSkip) or the dashboard CTA.
 * Nothing is uploaded; the parse is simulated for the marketing demo.
 */
export interface ParseSummary {
  items: number;
  vendors: number;
}
interface Msg {
  id: number;
  role: "system" | "user";
  text: string;
}

let seq = 0;
const nextId = () => (seq += 1);

// Believable figures "read" from the bill (demo — nothing leaves the browser).
const PARSED: ParseSummary = { items: 482, vendors: 18 };

export function ReceiptChat({
  onParsed,
  onSkip,
}: {
  onParsed: (s: ParseSummary) => void;
  onSkip: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    { id: nextId(), role: "system", text: COPY.chatGreeting },
  ]);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || busy) return;
    setMessages((m) => [...m, { id: nextId(), role: "user", text: "📄 " + file.name }]);
    setBusyText("Bill scan kar raha hoon…");
    setBusy(true);
    // Simulated parse (no upload) — a beat, then a result, then bloom the app.
    window.setTimeout(() => {
      if (!alive.current) return;
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: "system",
          text: `Ho gaya! Is bill se ${PARSED.items} items aur ${PARSED.vendors} vendors mile.`,
        },
      ]);
      setBusyText("Aapka dashboard bana raha hoon…");
      window.setTimeout(() => {
        if (alive.current) onParsed(PARSED);
      }, 900);
    }, 1600);
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
        {busy && (
          <div className="flex max-w-[85%] items-center gap-2 self-start rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-text-tertiary">
            <Loader2 className="size-4 animate-spin" /> {busyText}
          </div>
        )}
      </div>

      {/* Action — upload a receipt, or skip to login */}
      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          onChange={handleFile}
        />
        <Button
          type="button"
          size="lg"
          variant="primary"
          className="w-full gap-2"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
          {busy ? "Ek second…" : "Bill ki photo daalein"}
        </Button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="mx-auto text-xs font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline disabled:opacity-50"
        >
          Upload skip karein — seedha login
        </button>
      </div>
    </Card>
  );
}
