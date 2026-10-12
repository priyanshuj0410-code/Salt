import { useEffect, useState } from "react";
import { Database, Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { useAuth } from "@/lib/auth";
import {
  EXPORT_DATASETS,
  type ExportDataset,
  countDataset,
  fetchDataset,
  stamp,
  toCsv,
  triggerDownload,
} from "@/lib/exportData";

/** Settings → Data export. Owner pulls their org data out as CSV or a JSON backup. */
export function DataExportPage() {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [csvBusy, setCsvBusy] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    (async () => {
      // Count each dataset independently so one failure never blanks the rest.
      const entries = await Promise.all(
        EXPORT_DATASETS.map(async (d) => {
          try {
            return [d.table, await countDataset(d.table, orgId)] as const;
          } catch {
            return [d.table, null] as const;
          }
        }),
      );
      if (!active) return;
      setCounts(Object.fromEntries(entries));
      setCountsLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [orgId]);

  async function exportCsv(d: ExportDataset) {
    if (!orgId || csvBusy || backupBusy) return;
    setCsvBusy(d.table);
    setError(null);
    try {
      const rows = await fetchDataset(d.table, orgId);
      if (rows.length === 0) {
        setError(`No data in ${d.label} to export yet.`);
        return;
      }
      triggerDownload(`salt-${d.table}-${stamp()}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCsvBusy(null);
    }
  }

  async function exportBackup() {
    if (!orgId || backupBusy || csvBusy) return;
    setBackupBusy(true);
    setError(null);
    try {
      const datasets: Record<string, unknown[]> = {};
      for (const d of EXPORT_DATASETS) datasets[d.table] = await fetchDataset(d.table, orgId);
      const payload = {
        app: "Salt",
        org_id: orgId,
        org_name: membership?.orgName ?? null,
        exported_at: new Date().toISOString(),
        datasets,
      };
      triggerDownload(`salt-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupBusy(false);
    }
  }

  const countLabel = (table: string) => {
    if (!countsLoaded) return "…";
    const n = counts[table];
    return n == null ? "-" : n.toLocaleString("en-IN");
  };

  return (
    <Page width="lg">
      <PageHeader
        icon={Database}
        title="Data export"
        subtitle="Take your data with you. A CSV per dataset, or one JSON backup of everything."
        actions={
          <Button onClick={exportBackup} disabled={backupBusy || !!csvBusy || !orgId}>
            <Download /> {backupBusy ? "Preparing backup…" : "Full backup (JSON)"}
          </Button>
        }
      />

      <p className="mb-4 text-sm text-text-secondary">
        Exports cover this organisation only. Each file is built in your browser from live data,
        nothing is sent anywhere except the download you trigger. No lock-in.
      </p>

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <DataTable<ExportDataset>
        rows={EXPORT_DATASETS}
        rowKey={(d) => d.table}
        cols="1.6fr 0.7fr 0.7fr"
        columns={[
          {
            key: "dataset",
            header: "Dataset",
            cell: (d) => (
              <>
                <span className="font-medium">{d.label}</span>
                <span className="ml-1.5 text-xs text-text-tertiary">{d.hint}</span>
              </>
            ),
          },
          {
            key: "rows",
            header: "Rows",
            numeric: true,
            cell: (d) => <span className="text-text-tertiary">{countLabel(d.table)}</span>,
          },
          {
            key: "action",
            header: "",
            numeric: true,
            cell: (d) => (
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCsv(d)}
                disabled={!!csvBusy || backupBusy || counts[d.table] === 0}
              >
                <FileDown /> {csvBusy === d.table ? "Exporting…" : "CSV"}
              </Button>
            ),
          },
        ]}
      />
    </Page>
  );
}
