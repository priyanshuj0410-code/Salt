import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The hero headline as a bilingual typewriter — it holds the Latin line, deletes
 * it, types the Devanagari line, and back, looping. Both phrases are stacked in a
 * SINGLE grid cell (invisible) so the box reserves the taller of the two and
 * nothing below (the chat widget) jumps as the text grows/shrinks; a visually-
 * hidden copy keeps the real headline in the a11y tree. Static under
 * prefers-reduced-motion, and paused (via `paused`) once the app blooms.
 *
 * Slices by GRAPHEME CLUSTER (Intl.Segmenter) so Devanagari conjuncts/matras are
 * never split — no intermediate frame shows a dangling virama or orphaned matra.
 */
type SegmenterLike = { segment(input: string): Iterable<{ segment: string }> };
const SEGMENTER: SegmenterLike | null = (() => {
  const I = Intl as unknown as {
    Segmenter?: new (locale?: string, opts?: { granularity: string }) => SegmenterLike;
  };
  return typeof I.Segmenter === "function" ? new I.Segmenter("hi", { granularity: "grapheme" }) : null;
})();

function graphemes(s: string): string[] {
  if (!SEGMENTER) return Array.from(s); // pre-Segmenter fallback (code points)
  const out: string[] = [];
  for (const seg of SEGMENTER.segment(s)) out.push(seg.segment);
  return out;
}

export function TypewriterHeadline({
  phrases,
  reduce,
  paused = false,
  className,
}: {
  phrases: string[];
  reduce: boolean;
  paused?: boolean;
  className?: string;
}) {
  const primary = phrases[0] ?? "";
  const [display, setDisplay] = useState(primary);

  useEffect(() => {
    if (reduce || paused || phrases.length < 2) return; // static / frozen
    let phraseIdx = 0;
    let count = graphemes(phrases[0]).length; // start fully typed
    let deleting = true;
    let timer = 0;

    const tick = () => {
      const units = graphemes(phrases[phraseIdx]);
      if (deleting) {
        count -= 1;
        setDisplay(units.slice(0, Math.max(0, count)).join(""));
        if (count <= 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
          count = 0;
          timer = window.setTimeout(tick, 260);
          return;
        }
        timer = window.setTimeout(tick, 26);
      } else {
        count += 1;
        setDisplay(units.slice(0, count).join(""));
        if (count >= units.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2600); // hold the readable line
          return;
        }
        timer = window.setTimeout(tick, 44);
      }
    };

    timer = window.setTimeout(tick, 2600); // hold the initial Latin line first
    return () => window.clearTimeout(timer);
  }, [phrases, reduce, paused]);

  return (
    <span className={cn("grid", className)}>
      {/* Sizers: every phrase overlaid in one grid cell → box = tallest line. */}
      {phrases.map((p, i) => (
        <span key={i} aria-hidden className="invisible col-start-1 row-start-1 block">
          {p}
        </span>
      ))}
      {/* The live, typed line overlaid in the same cell. */}
      <span aria-hidden className="col-start-1 row-start-1 block">
        {display}
        {!reduce && (
          <span className="ml-1 inline-block h-[0.8em] w-[3px] translate-y-[0.08em] animate-pulse bg-current align-middle" />
        )}
      </span>
      <span className="sr-only">{primary}</span>
    </span>
  );
}
