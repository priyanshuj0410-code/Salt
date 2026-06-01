import { Badge } from "@/components/ui/badge";
import type { Schedule } from "@/lib/types";

/**
 * Drug-schedule pill. The colour encodes control level so an H1 or X item is
 * impossible to miss in a long list: OTC is neutral, H is informational, H1
 * warns (register entry required), X is the strictest (narcotic / licence).
 */
const SCHEDULE_META: Record<Schedule, { variant: "neutral" | "info" | "warning" | "danger"; title: string }> = {
  OTC: { variant: "neutral", title: "Over the counter — no prescription needed" },
  H: { variant: "info", title: "Schedule H — prescription required" },
  H1: { variant: "warning", title: "Schedule H1 — prescription + register entry" },
  X: { variant: "danger", title: "Schedule X — narcotic; pharmacist + Form 20F licence" },
};

export function ScheduleBadge({ schedule }: { schedule: Schedule }) {
  const meta = SCHEDULE_META[schedule] ?? SCHEDULE_META.OTC;
  return (
    <Badge variant={meta.variant} title={meta.title}>
      {schedule}
    </Badge>
  );
}

/** AYUSH / non-allopathic marker (ayurveda, siddha, unani, homeopathy). */
export function AyushBadge() {
  return (
    <Badge variant="success" title="AYUSH / non-allopathic — no Drugs-&-Cosmetics schedule">
      AYUSH
    </Badge>
  );
}
