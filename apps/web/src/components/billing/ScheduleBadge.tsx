import { Badge } from "@/components/ui/badge";
import type { Schedule } from "@/lib/types";

const config: Record<Schedule, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  OTC: { label: "OTC", variant: "outline" },
  H: { label: "Sch. H", variant: "secondary" },
  H1: { label: "Sch. H1", variant: "destructive" },
  X: { label: "Sch. X", variant: "destructive" },
};

export function ScheduleBadge({ schedule }: { schedule: Schedule }) {
  const { label, variant } = config[schedule];
  return <Badge variant={variant}>{label}</Badge>;
}
