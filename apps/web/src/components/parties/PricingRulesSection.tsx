import { useEffect, useState } from "react";
import { Tag, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";

type RuleType = "pct_off_mrp" | "flat_price_paise" | "margin_target";
const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: "pct_off_mrp", label: "% off MRP" },
  { value: "flat_price_paise", label: "Flat ₹" },
  { value: "margin_target", label: "% margin" },
];

interface PriceRule {
  id: string;
  item_id: string | null;
  hsn: string | null;
  rule_type: RuleType;
  rule_value: number;
  label: string | null;
  priority: number;
  active: boolean;
}
interface ItemHit {
  id: string;
  name: string;
  hsn: string | null;
}

/** Human summary of a rule's effect, also stored as its `label` (the bill "why"). */
function ruleSummary(rt: RuleType, value: number): string {
  if (rt === "flat_price_paise") return `${formatPaise(Math.round(value))} flat`;
  if (rt === "margin_target") return `${value}% margin on cost`;
  return `${value}% off MRP`;
}

/**
 * Per-party pricing rules (SALT-049) on top of the SALT-010 backbone
 * (`price_rules` + `resolve_price`, migration 0039). Create/list/delete rules
 * for this customer (item-specific or all items) and live-preview the effective
 * price for an item. Self-contained + defensive: if 0039 is not applied yet the
 * section hides itself rather than breaking the profile.
 */
export function PricingRulesSection({ ledgerId }: { ledgerId: string }) {
  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shopId;
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // item picker (scope) + live preview
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [item, setItem] = useState<ItemHit | null>(null);
  const [preview, setPreview] = useState<{ price: number; why: string } | null>(null);

  // new-rule form
  const [ruleType, setRuleType] = useState<RuleType>("pct_off_mrp");
  const [value, setValue] = useState("");
  const [priority, setPriority] = useState("0");

  const loadRules = async () => {
    if (!supabase) return;
    const { data, error: err } = await supabase
      .from("price_rules")
      .select("id,item_id,hsn,rule_type,rule_value,label,priority,active")
      .eq("party_id", ledgerId)
      .order("priority", { ascending: false });
    if (err) {
      setAvailable(false); // table absent (0039 unapplied) → hide
      return;
    }
    setRules((data as PriceRule[] | null) ?? []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      await loadRules();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerId]);

  // item search (scope picker / preview target)
  useEffect(() => {
    const q = query.trim();
    let active = true;
    void (async () => {
      if (!supabase || !orgId || q.length < 2) {
        setHits([]);
        return;
      }
      const { data } = await supabase
        .from("items")
        .select("id,name,hsn")
        .eq("org_id", orgId)
        .ilike("name", `%${q}%`)
        .limit(8);
      if (active) setHits((data as ItemHit[] | null) ?? []);
    })();
    return () => {
      active = false;
    };
  }, [query, orgId]);

  // live preview: resolve the effective price for the picked item + this party
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!supabase || !item) {
        setPreview(null);
        return;
      }
      const { data, error: err } = await supabase.rpc("resolve_price", {
        p_party_id: ledgerId,
        p_item_id: item.id,
        p_shop_id: shopId,
      });
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      setPreview(err || !row ? null : { price: row.price_paise as number, why: (row.rule_label as string) ?? "MRP" });
    })();
    return () => {
      active = false;
    };
  }, [item, ledgerId, shopId, rules]);

  function pickItem(h: ItemHit) {
    setItem(h);
    setQuery(h.name);
    setHits([]);
  }

  async function addRule() {
    if (!supabase || !orgId || busy) return;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a value greater than 0.");
      return;
    }
    // flat price is entered in rupees, stored in paise; others are percentages.
    const ruleValue = ruleType === "flat_price_paise" ? Math.round(num * 100) : num;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("price_rules").insert({
      org_id: orgId,
      party_id: ledgerId,
      item_id: item?.id ?? null,
      rule_type: ruleType,
      rule_value: ruleValue,
      label: ruleSummary(ruleType, ruleValue),
      priority: Math.trunc(Number(priority) || 0),
      active: true,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setValue("");
    await loadRules();
  }

  async function removeRule(id: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("price_rules").delete().eq("id", id);
    setBusy(false);
    if (err) setError(err.message);
    else setRules((rs) => rs.filter((r) => r.id !== id));
  }

  if (loading || !available) return null;

  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-text-primary">
        <Tag className="size-4 text-text-tertiary" /> Special pricing
      </h2>
      <p className="mb-3 text-xs text-text-tertiary">
        Charge this customer a custom price instead of MRP. Highest priority wins; billing shows the rule as the “why”.
      </p>

      {/* existing rules */}
      {rules.length > 0 ? (
        <div className="mb-3 divide-y divide-divider rounded-md border border-border">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Badge variant="neutral" className="shrink-0 tabular-nums">P{r.priority}</Badge>
              <span className="min-w-0 flex-1 truncate">
                {r.label || ruleSummary(r.rule_type, r.rule_value)}
                <span className="text-text-tertiary"> · {r.item_id ? "this item" : r.hsn ? `HSN ${r.hsn}` : "all items"}</span>
                {!r.active && <span className="text-text-tertiary"> · inactive</span>}
              </span>
              <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => removeRule(r.id)} aria-label="Delete rule">
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-text-tertiary">No pricing rules yet — this customer pays MRP.</p>
      )}

      {/* item scope + live preview */}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setItem(null);
          }}
          placeholder="Search an item to scope the rule / preview (blank = all items)"
          className="h-9"
        />
        {hits.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => pickItem(h)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface"
              >
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                {h.hsn && <span className="shrink-0 text-xs text-text-tertiary">HSN {h.hsn}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {item && preview && (
        <p className="mt-2 text-xs text-text-secondary">
          Preview · <span className="font-medium">{item.name}</span>: effective price{" "}
          <span className="font-medium tabular-nums">{formatPaise(preview.price)}</span>{" "}
          <span className="text-text-tertiary">({preview.why})</span>
        </p>
      )}

      {/* new rule */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex gap-1.5">
          {RULE_TYPES.map((t) => (
            <Button
              key={t.value}
              type="button"
              size="sm"
              variant={ruleType === t.value ? "default" : "outline"}
              onClick={() => setRuleType(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={ruleType === "flat_price_paise" ? "₹" : "%"}
          className="h-9 w-24 text-right tabular-nums"
        />
        <label className="flex items-center gap-1 text-xs text-text-tertiary">
          priority
          <Input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-9 w-16 text-right tabular-nums"
          />
        </label>
        <Button size="sm" disabled={busy || !value} onClick={addRule}>
          <Plus /> Add rule {item ? "for this item" : "for all items"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}
