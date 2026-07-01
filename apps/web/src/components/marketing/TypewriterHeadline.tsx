import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The hero headline as a bilingual typewriter — it holds the Latin line, deletes
 * it, types the Devanagari line, holds, deletes, and types the Latin line again,
 * looping. Both phrases are stacked in a SINGLE grid cell (invisible) so the box
 * reserves the taller of the two and nothing below (the chat widget) jumps as the
 * text grows/shrinks; a visually-hidden copy keeps the real headline in the a11y
 * tree. Respects prefers-reduced-motion (renders static Latin).
 *
 * Slices by code point (Array.from) so Devanagari clusters are not split across
 * UTF-16 surrogate units mid-type.
 */
export function TypewriterHeadline({
  phrases,
  reduce,
  className,
}: {
  phrases: string[];
  reduce: boolean;
  className?: string;
}) {
  const primary = phrases[0] ?? "";
  const [display, setDisplay] = useState(primary);

  useEffect(() => {
    if (reduce || phrases.length < 2) return; // static headline
    let phraseIdx = 0;
    let chars = Array.from(phrases[0]).length; // start fully typed
    let deleting = true;
    let timer = 0;

    const tick = () => {
      const current = Array.from(phrases[phraseIdx]);
      if (deleting) {
        chars -= 1;
        setDisplay(current.slice(0, Math.max(0, chars)).join(""));
        if (chars <= 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % phrases.length;
          chars = 0;
          timer = window.setTimeout(tick, 260);
          return;
        }
        timer = window.setTimeout(tick, 22);
      } else {
        chars += 1;
        setDisplay(current.slice(0, chars).join(""));
        if (chars >= current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2600); // hold the readable line
          return;
        }
        timer = window.setTimeout(tick, 38);
      }
    };

    timer = window.setTimeout(tick, 2600); // hold the initial Latin line first
    return () => window.clearTimeout(timer);
  }, [phrases, reduce]);

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
