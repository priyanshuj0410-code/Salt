import { useEffect, useState } from "react";
import { Download, Search, ShieldCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { Truncate } from "@/components/patterns/truncate";
import { PageHeader } from "@/components/patterns/page-header";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { triggerDownload } from "@/lib/exportData";

interface Party {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  gstin: string | null;
}

const SELECT = "id,name,type,phone,gstin";

/** Friendlier message when the 0041 RPCs aren't installed in this DB yet. */
function rpcError(msg: string): string {
  if (/function|does not exist|not find|schema cache/i.test(msg)) {
    return "The party-privacy functions aren't installed yet: run supabase/migrations/0041_party_pii.sql, then retry.";
  }
  return msg;
}

/** Settings → Data privacy. Right-to-access (export) + right-to-erasure for a party (DPDP). */
export function PartyPrivacyPage() {
  const orgId = useAuth().membership?.orgId;
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Party[]>([]);
  const [selected, setSelected] = useState<Party | null>(null);
  const [busy, setBusy] = useState<"export" | "erase" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  // Search parties as the owner types (>= 2 chars).
  useEffect(() => {
    if (!supabase || !orgId) return;
    const q = term.trim();
    if (q.length < 2) return; // dropdown is hidden below 2 chars; leave stale results untouched
    let active = true;
    supabase
      .from("ledgers")
      .select(SELECT)
      .eq("org_id", orgId)
      .ilike("name", `%${q}%`)
      .order("name", { ascending: true })
      .limit(20)
      .then(({ data }) => {
        if (!active) return;
        setResults((data as Party[] | null) ?? []);
      });
    return () => {
      active = false;
    };
  }, [term, orgId]);

  function pick(p: Party) {
    setSelected(p);
    setResults([]);
    setTerm("");
    setError(null);
    setNotice(null);
  }

  async function exportPii() {
    if (!supabase || !selected || busy) return;
    setBusy("export");
    setError(null);
    setNotice(null);
    try {
      const { data, error: err } = await supabase.rpc("export_party_pii", { p_party_id: selected.id });
      if (err) {
        setError(rpcError(err.message));
        return;
      }
      triggerDownload(`party-${selected.id}.json`, JSON.stringify(data, null, 2), "application/json");
      setNotice("Personal-data export downloaded.");
    } finally {
      setBusy(null);
    }
  }

  async function erasePii() {
    if (!supabase || !selected || busy) return;
    setBusy("erase");
    setError(null);
    setNotice(null);
    try {
      const { error: err } = await supabase.rpc("erase_party_pii", { p_party_id: selected.id });
      if (err) {
        setError(rpcError(err.message));
        return;
      }
      setConfirmErase(false);
      // Re-fetch so the now-anonymised name is shown.
      const { data } = await supabase.from("ledgers").select(SELECT).eq("id", selected.id).maybeSingle();
      if (data) setSelected(data as Party);
      setNotice("Personal data erased. Financial postings were kept for GST retention.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={ShieldCheck}
        title="Data privacy"
        subtitle="Export or erase a party's personal data (DPDP, right to access & erasure)."
      />

      <p className="mb-4 text-sm text-text-secondary">
        Look up a customer or vendor, then download everything Salt holds about them, or erase their
        personal details. <span className="font-medium text-text-primary">Erase anonymises</span> the
        party (name, phone, GSTIN, address), financial postings are retained as the law requires.
      </p>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search a party by name…"
          className="pl-8"
        />
        {term.trim().length >= 2 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-text-tertiary">No parties match.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Truncate text={p.name} className="min-w-0" />
                      {p.type && <Badge variant="neutral">{p.type}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {notice && (
        <p className="mt-4 rounded-md border border-success-border bg-success-bg px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {/* Selected party */}
      {selected && (
        <div className="mt-4 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <span className="font-medium">{selected.name}</span>
            {selected.type && <Badge variant="neutral">{selected.type}</Badge>}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {selected.phone ? selected.phone : "No phone"}
            {selected.gstin ? ` · GSTIN ${selected.gstin}` : ""}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={exportPii} disabled={busy != null}>
              <Download /> {busy === "export" ? "Exporting…" : "Export personal data"}
            </Button>
            <Button variant="danger" onClick={() => setConfirmErase(true)} disabled={busy != null}>
              <UserX /> Erase personal data
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmErase} onOpenChange={(o) => !o && setConfirmErase(false)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <EraseConfirm
              party={selected}
              busy={busy === "erase"}
              onConfirm={erasePii}
              onCancel={() => setConfirmErase(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function EraseConfirm({
  party,
  busy,
  onConfirm,
  onCancel,
}: {
  party: Party;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const armed = typed.trim().toLowerCase() === party.name.trim().toLowerCase();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Erase personal data?</DialogTitle>
        <DialogDescription>
          This anonymises <span className="font-medium text-foreground">{party.name}</span>: name,
          phone, GSTIN and address are cleared. It is <span className="font-medium">irreversible</span>.
          Invoices, payments and other financial postings are kept (GST retention).
        </DialogDescription>
      </DialogHeader>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Type the party's name to confirm
        </span>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={party.name} />
      </label>

      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={!armed || busy}>
          <UserX /> {busy ? "Erasing…" : "Erase permanently"}
        </Button>
      </DialogFooter>
    </>
  );
}
