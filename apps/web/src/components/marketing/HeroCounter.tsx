import type { ReactNode } from "react";

import { COPY } from "./copy";

/**
 * The "Digital Counter" hero — a video placeholder of the founder behind a
 * Varanasi pharmacy counter, with the verbatim overlay copy and quiet local
 * trust chips. The chat widget is injected as `widget` so this stays a pure
 * presentational shell. The page is fully usable with no video (gradient +
 * scrim is the default; video is progressive enhancement).
 */

// Media placeholder for the hero video — a calm, premium counter backdrop.
// (Marketing-only atmosphere, not app chrome, so it uses literal colours.)
const GRADIENT =
  "radial-gradient(1100px 560px at 18% 8%, #134e4a 0%, rgba(19,78,74,0) 60%)," +
  "radial-gradient(1000px 680px at 92% 96%, #1e3a8a 0%, rgba(30,58,138,0) 55%)," +
  "linear-gradient(158deg, #0b1220 0%, #18181b 100%)";

export function HeroCounter({
  videoSrc,
  onLogin,
  widget,
}: {
  videoSrc?: string;
  onLogin: () => void;
  widget: ReactNode;
}) {
  return (
    <div className="relative min-h-[100dvh] w-full">
      {/* Video / gradient backdrop + scrim for text contrast */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {videoSrc ? (
          <video
            className="h-full w-full object-cover"
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden
          />
        ) : null}
        <div className="absolute inset-0" style={{ background: GRADIENT }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/25 to-black/45" />
      </div>

      {/* Top bar: wordmark + a low-emphasis login escape hatch for returning shops */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-5">
        <span className="font-display text-lg font-semibold text-white">Salt</span>
        <button
          type="button"
          onClick={onLogin}
          className="rounded-md px-1 text-xs text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          Already a customer? Login
        </button>
      </div>

      {/* Hero content: copy (left/desktop) + chat widget (right/desktop, below on mobile) */}
      <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-3.75rem)] w-full max-w-6xl grid-cols-1 items-center gap-8 px-4 pb-8 md:grid-cols-2 md:gap-10 md:pb-10">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 ring-1 ring-white/15 backdrop-blur">
            Sirf chemists ke liye bana
          </span>
          <h1 className="mt-4 text-[1.75rem] leading-tight font-semibold text-balance text-white sm:text-4xl md:text-5xl">
            {COPY.headline}
          </h1>
          <p className="mt-4 max-w-md text-base text-white/85 sm:text-lg">{COPY.subhead}</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {COPY.trust.map((t) => (
              <li
                key={t}
                className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/90 ring-1 ring-white/15 backdrop-blur"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center md:justify-end">{widget}</div>
      </div>
    </div>
  );
}
