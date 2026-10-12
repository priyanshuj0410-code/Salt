import { useState, useEffect } from "react";
import { Boxes, Upload, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { planOpeningMovements, type OpeningBatch, type OpeningPlan } from "@/lib/openingStock";

const CHUNK = 500;

/**
 * Posts an `opening` stock_movement per imported batch so the movement ledger
 * reconciles to batches.qty at cutover. On-hand is unaffected (it reads
 * batches.qty), so this is purely the audit/valuation ledger. Idempotent —
 * batches that already have an opening movement are skipped.
 */
export function OpeningStockStep({
  orgId,
  shopId,
  onComplete,
}: {
  orgId: string | undefined;
  shopId: string | null | undefined;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"scan" | "result">("scan");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [plan, setPlan] = useState<OpeningPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(0);

  // Scan batches vs already-posted opening movements (re-run via the nonce). State
  // is only set after the async boundary, never synchronously in the effect body.
  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    Promise.all([
      selectAll<OpeningBatch>((f, t) =>
        supabase!.from("batches").select("id,item_id,qty,ptr_paise,shop_id").eq("org_id", orgId).range(f, t),
      ),
      selectAll<{ batch_id: string | null }>((f, t) =>
        supabase!
          .from("stock_movements")
          .select("batch_id")
          .eq("org_id", orgId)
          .eq("reason", "opening")
          .not("batch_id", "is", null)
          .range(f, t),
      ),
    ])
      .then(([batches, existing]) => {
        if (!active) return;
        const set = new Set(existing.map((e) => e.batch_id).filter((b): b is string => Boolean(b)));
        setPlan(planOpeningMovements(batches, set, shopId ?? null));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Scan failed");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, shopId, nonce]);

  function rescan() {
    setPlan(null);
    setError(null);
    setLoading(true);
    setNonce((n) => n + 1);
  }

  async function post() {
    if (!supabase || !orgId || !plan) return;
    setBusy(true);
    setError(null);
    try {
      const payload = plan.movements.map((m) => ({ ...m, org_id: orgId }));
      let n = 0;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const { error: err } = await supabase.from("stock_movements").insert(slice);
        if (err) {
          setError(err.message);
          return;
        }
        n += slice.length;
      }
      setPosted(n);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- result phase ----
  if (phase === "result") {
    return (
      <div className="rounded-lg border p-5">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {posted} opening movement{posted === 1 ? "" : "s"} posted: the stock ledger now reconciles to
          on-hand.
        </p>
        <div className="mt-4">
          <Button onClick={onComplete}>Continue to next step</Button>
        </div>
      </div>
    );
  }

  // ---- scan phase ----
  const need = plan?.movements.length ?? 0;
  return (
    <div className="rounded-lg border p-5">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Boxes className="size-4 text-primary" />
          Opening stock ledger
        </div>
        <p className="mt-2 text-sm text-text-tertiary">
          Post an opening balance to the stock movement ledger for every imported batch, so your
          inventory movement history reconciles to current stock. On-hand is unchanged: this only fills
          in the audit ledger. Run once after importing batches; safe to re-run.
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-text-tertiary">
          <RotateCw className="size-4 animate-spin" /> Scanning your stock…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{need} batches need an opening movement</span>
            {(plan?.skippedExisting ?? 0) > 0 && (
              <span className="text-text-tertiary">{plan?.skippedExisting} already posted</span>
            )}
            {(plan?.skippedZero ?? 0) > 0 && (
              <span className="text-text-tertiary">{plan?.skippedZero} zero-stock (skipped)</span>
            )}
          </div>
          {(plan?.skippedNoShop ?? 0) > 0 && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-500">
              {plan?.skippedNoShop} batches have no shop and there is no active shop. Set a primary shop,
              then re-scan.
            </p>
          )}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            {need > 0 ? (
              <Button onClick={post} disabled={busy}>
                <Upload />
                {busy ? "Posting…" : `Post ${need} opening movement${need === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <Button onClick={onComplete}>
                {(plan?.skippedExisting ?? 0) > 0 ? "Already reconciled: continue" : "Nothing to post: continue"}
              </Button>
            )}
            <Button variant="ghost" onClick={rescan} disabled={busy || loading}>
              Re-scan
            </Button>
          </div>
          <div className="mt-3 text-center">
            <button onClick={onComplete} className="text-xs text-text-tertiary hover:text-foreground">
              Skip this step
            </button>
          </div>
        </>
      )}
    </div>
  );
}
