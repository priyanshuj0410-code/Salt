import { useEffect, useRef, useState } from "react";
import { BarChart3, Check, Landmark, Package, Receipt, Settings, Sparkles, UploadCloud, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";

/**
 * The "Aha!" dashboard revealed after auth — rendered inside a `.dark` wrapper
 * (see LandingPage) so it uses Salt's real dark tokens. Feature chrome is
 * deliberately quiet; the single focal action is the centred DBF drag-and-drop.
 * Drop OR click OR keyboard runs a simulated 0→100 import, then the persistent
 * "Enter Salt" CTA hands off to the real app ("/") via `onEnter`.
 */
const NAV = [
  { icon: Receipt, label: "Billing" },
  { icon: Package, label: "Inventory" },
  { icon: Landmark, label: "GST" },
  { icon: Users, label: "Parties" },
  { icon: BarChart3, label: "Reports" },
  { icon: Settings, label: "Settings" },
] as const;

export function DashboardReveal({ onEnter }: { onEnter: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const pRef = useRef(0);

  // Progress ticks live in the interval callback (async), not the effect body,
  // so we stay clear of the "no setState in useEffect" lint rule.
  useEffect(() => {
    if (!uploading) return;
    const id = window.setInterval(() => {
      pRef.current = Math.min(100, pRef.current + 6);
      setProgress(pRef.current);
      if (pRef.current >= 100) {
        window.clearInterval(id);
        setUploading(false);
        setDone(true);
      }
    }, 80);
    return () => window.clearInterval(id);
  }, [uploading]);

  function start() {
    if (uploading || done) return;
    pRef.current = 0;
    setProgress(0);
    setUploading(true);
  }

  return (
    <div className="flex h-full w-full bg-background text-text-primary">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="px-4 py-4">
          <span className="font-display text-lg font-semibold">Salt</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {NAV.map((n, i) => (
            <span
              key={n.label}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                i === 0 ? "bg-surface-2 font-medium text-text-primary" : "text-text-secondary",
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </span>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
          <div>
            <div className="text-sm font-medium">Welcome to Salt</div>
            <div className="text-xs text-text-tertiary">Aapki dukaan, ab cloud par</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onEnter}>
            Skip for now
          </Button>
        </header>

        <div className="flex flex-1 items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-xl">
            {!done ? (
              <button
                type="button"
                onClick={start}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  start();
                }}
                autoFocus
                aria-label="Import your Marg DBF file"
                className="group flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-border-strong bg-surface/40 px-6 py-12 text-center transition-colors hover:border-text-tertiary hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                <span className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-text-secondary">
                  {uploading ? <Sparkles className="size-7 animate-pulse" /> : <UploadCloud className="size-7" />}
                </span>
                <p className="max-w-md text-sm text-text-secondary md:text-base">{COPY.dropzone}</p>

                {uploading ? (
                  <div className="w-full max-w-sm">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-75"
                        style={{ width: progress + "%" }}
                      />
                    </div>
                    <div className="mt-2 text-xs text-text-tertiary">
                      {progress}% · Marg data import ho raha hai…
                    </div>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                    <UploadCloud className="size-4" /> DBF file chunein
                  </span>
                )}
              </button>
            ) : (
              <div className="flex animate-in fade-in zoom-in-95 flex-col items-center gap-4 rounded-2xl border border-success-border bg-success-bg px-6 py-12 text-center duration-300">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-success/15 text-success">
                  <Check className="size-7" />
                </span>
                <div>
                  <div className="text-lg font-semibold text-text-primary">Ho gaya — 2,480 items import ho gaye.</div>
                  <p className="mt-1 text-sm text-text-secondary">
                    Aapka pura stock, batches aur rates ab Salt mein hain.
                  </p>
                </div>
                <Button variant="primary" size="lg" autoFocus onClick={onEnter}>
                  Enter Salt →
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom bar */}
        <nav className="flex items-center justify-around border-t border-border bg-surface px-2 py-2 md:hidden">
          {NAV.slice(0, 5).map((n, i) => (
            <span
              key={n.label}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-[0.625rem]",
                i === 0 ? "text-text-primary" : "text-text-tertiary",
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </span>
          ))}
        </nav>
      </main>
    </div>
  );
}
