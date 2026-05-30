import { supabase } from "@/lib/supabase";

export type PartyType = "customer" | "vendor" | "other";

/**
 * Classify party names server-side via the `classify_parties` RPC
 * (keyword control-account → known vendor → else customer). Returns a
 * name → type map; falls back to an empty map (i.e. all-customer) on error.
 */
export async function classifyParties(names: string[]): Promise<Map<string, PartyType>> {
  const map = new Map<string, PartyType>();
  if (!supabase || names.length === 0) return map;
  const { data, error } = await supabase.rpc("classify_parties", { p_names: names });
  if (error || !data) return map; // fall back to all-customer; fixable later
  for (const r of data as { name: string; type: PartyType }[]) map.set(r.name, r.type);
  return map;
}
