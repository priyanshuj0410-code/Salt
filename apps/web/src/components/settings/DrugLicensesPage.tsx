import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Plus, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/ui/dot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { licenseStatus } from "@/lib/licenses";

/** A row of the `drug_licenses` table (per-org RLS via is_member). */
interface DrugLicense {
  id: string;
  license_type: string;
  license_no: string;
  holder_name: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
}

const SELECT = "id,license_type,license_no,holder_name,issued_date,expiry_date,notes,created_at";

/** Common Drugs & Cosmetics Rules license forms — suggestions, not a closed list. */
const LICENSE_TYPES = [
  "Form 20 (retail — allopathic)",
  "Form 21 (retail — Schedule C & C1)",
  "Form 20A (restricted retail)",
  "Form 20B (wholesale — allopathic)",
  "Form 21B (wholesale — Schedule C & C1)",
  "Form 20F (Schedule X — retail)",
  "Form 21F (Schedule X — wholesale)",
  "Form 20C (homeopathic — retail)",
  "Form 20D (homeopathic — wholesale)",
];

const fmtDate = (d: string | null) => (d ? format(parseISO(d), "d MMM yyyy") : "—");

interface Draft {
  id?: string;
  license_type: string;
  license_no: string;
  holder_name: string;
  issued_date: string;
  expiry_date: string;
  notes: string;
}

const BLANK: Draft = { license_type: "", license_no: "", holder_name: "", issued_date: "", expiry_date: "", notes: "" };

const toDraft = (l: DrugLicense): Draft => ({
  id: l.id,
  license_type: l.license_type,
  license_no: l.license_no,
  holder_name: l.holder_name ?? "",
  issued_date: l.issued_date ?? "",
  expiry_date: l.expiry_date ?? "",
  notes: l.notes ?? "",
});

/** Settings → Drug licenses. Records the shop's D&C licenses and flags renewals. */
export function DrugLicensesPage() {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const [rows, setRows] = useState<DrugLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("drug_licenses")
      .select(SELECT)
      .eq("org_id", orgId)
      .order("expiry_date", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        if (!active) return;
        setRows((data as DrugLicense[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  // Soonest-to-expire first; no-expiry licenses sink to the bottom.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => licenseStatus(a).sortKey - licenseStatus(b).sortKey),
    [rows],
  );

  const alert = useMemo(() => {
    const flagged = rows.map(licenseStatus).filter((s) => s.attention);
    return { count: flagged.length, expired: flagged.filter((s) => s.expired).length };
  }, [rows]);
  const soonest = sorted[0];
  const soonestStatus = soonest ? licenseStatus(soonest) : null;

  return (
    <Page width="lg">
      <PageHeader
        icon={ScrollText}
        title="Drug licenses"
        subtitle={
          rows.length > 0
            ? `${rows.length} license${rows.length === 1 ? "" : "s"} on record`
            : "Drugs & Cosmetics licenses for this shop, with renewal alerts"
        }
        actions={
          <Button onClick={() => setEditing(BLANK)} disabled={!shopId}>
            <Plus /> Add license
          </Button>
        }
      />

      {!shopId && (
        <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
          No shop is set up for your organisation yet. Set one up in Settings → Organisation before
          adding licenses.
        </p>
      )}

      {alert.count > 0 && soonest && soonestStatus && (
        <div
          className={cn(
            "mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
            alert.expired > 0
              ? "border-danger-border bg-danger-bg text-danger"
              : "border-warning-border bg-warning-bg text-warning",
          )}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <span className="font-medium">
              {alert.count} license{alert.count === 1 ? "" : "s"} need attention
            </span>
            {alert.expired > 0 && ` — ${alert.expired} already expired`}.{" "}
            <span className="text-text-secondary">
              Soonest: {soonest.license_type} ({soonest.license_no}) — {soonestStatus.label.toLowerCase()}.
            </span>
          </div>
        </div>
      )}

      <DataTable<DrugLicense>
        rows={sorted}
        rowKey={(l) => l.id}
        cols="1.6fr 1fr 0.8fr 0.9fr 1fr"
        onRowActivate={(l) => setEditing(toDraft(l))}
        loading={loading}
        empty={
          <EmptyState
            icon={ScrollText}
            title="No licenses recorded"
            hint="Add your retail (Form 20/21) or wholesale (Form 20B/21B) drug license so renewals never slip."
            action={
              shopId ? (
                <Button size="sm" onClick={() => setEditing(BLANK)}>
                  <Plus /> Add license
                </Button>
              ) : undefined
            }
          />
        }
        columns={[
          {
            key: "license",
            header: "License",
            cell: (l) => (
              <>
                <span className="font-medium">{l.license_type}</span>
                <span className="ml-1.5 font-mono text-xs text-text-tertiary">{l.license_no}</span>
              </>
            ),
          },
          { key: "holder", header: "Holder", cell: (l) => l.holder_name ?? <span className="text-text-tertiary">—</span> },
          { key: "issued", header: "Issued", cell: (l) => <span className="text-text-tertiary">{fmtDate(l.issued_date)}</span> },
          { key: "expiry", header: "Expiry", cell: (l) => fmtDate(l.expiry_date) },
          {
            key: "status",
            header: "Status",
            cell: (l) => {
              const s = licenseStatus(l);
              return (
                <span className="inline-flex items-center gap-1.5">
                  <Dot variant={s.variant} />
                  <Badge variant={s.variant}>{s.label}</Badge>
                </span>
              );
            },
          },
        ]}
      />

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <LicenseForm
              key={editing.id ?? "new"}
              initial={editing}
              orgId={orgId}
              shopId={shopId}
              onDone={() => {
                setEditing(null);
                setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function LicenseForm({
  initial,
  orgId,
  shopId,
  onDone,
  onCancel,
}: {
  initial: Draft;
  orgId: string | undefined;
  shopId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const isEdit = Boolean(initial.id);

  function edit<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
    setError(null);
  }

  async function save() {
    if (!supabase || busy) return;
    if (!draft.license_type.trim() || !draft.license_no.trim()) {
      setError("License type and number are required.");
      return;
    }
    if (draft.issued_date && draft.expiry_date && draft.expiry_date < draft.issued_date) {
      setError("Expiry date can't be before the issue date.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      license_type: draft.license_type.trim(),
      license_no: draft.license_no.trim(),
      holder_name: draft.holder_name.trim() || null,
      issued_date: draft.issued_date || null,
      expiry_date: draft.expiry_date || null,
      notes: draft.notes.trim() || null,
    };
    try {
      const { error: err } = draft.id
        ? await supabase.from("drug_licenses").update(payload).eq("id", draft.id)
        : await supabase.from("drug_licenses").insert({ ...payload, org_id: orgId, shop_id: shopId });
      if (err) {
        setError(err.message);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!supabase || !draft.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("drug_licenses").delete().eq("id", draft.id);
      if (err) {
        setError(err.message);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit license" : "Add drug license"}</DialogTitle>
        <DialogDescription>
          Recorded against this shop. Salt flags renewals at 90, 60 and 30 days before expiry.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="License type" required>
          <Input
            list="dl-license-types"
            value={draft.license_type}
            onChange={(e) => edit("license_type", e.target.value)}
            placeholder="e.g. Form 20"
          />
          <datalist id="dl-license-types">
            {LICENSE_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="License number" required>
          <Input
            value={draft.license_no}
            onChange={(e) => edit("license_no", e.target.value)}
            placeholder="—"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Holder name" hint="Whose name the license is issued in.">
          <Input value={draft.holder_name} onChange={(e) => edit("holder_name", e.target.value)} placeholder="—" />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Issued date">
          <Input type="date" value={draft.issued_date} onChange={(e) => edit("issued_date", e.target.value)} />
        </Field>
        <Field label="Expiry date" hint="Drives the renewal alert.">
          <Input type="date" value={draft.expiry_date} onChange={(e) => edit("expiry_date", e.target.value)} />
        </Field>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          <textarea
            value={draft.notes}
            onChange={(e) => edit("notes", e.target.value)}
            rows={2}
            placeholder="—"
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="sm:justify-between">
        {isEdit ? (
          <Button
            variant="danger"
            onClick={() => (armDelete ? void remove() : setArmDelete(true))}
            disabled={busy}
          >
            <Trash2 /> {armDelete ? "Confirm delete" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add license"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
