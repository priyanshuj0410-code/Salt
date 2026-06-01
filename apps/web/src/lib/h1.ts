/**
 * Schedule H1/X dispensing register (SALT-065). Reads the live `h1_register` rows
 * (written per H1/X sale line by `create_sales_invoice`, migration 0032) into the
 * legally-required register — a dated, filterable ledger of the prescriber +
 * patient details — exportable as CSV and a print/PDF for the drug inspector
 * (Drugs & Cosmetics Rules, Schedule H1; 3-year retention).
 *
 * The filter/format helpers here are pure (no Supabase, no DOM) and smoke-tested;
 * `printH1Register` is the thin `window.print()` wrapper (same pattern as
 * `lib/destruction.ts`).
 */

export interface H1Row {
  soldAt: string; // ISO timestamp
  drugName: string;
  schedule: string; // 'H' | 'H1' | 'X'
  qty: number;
  batchNo: string;
  expiry: string;
  doctorName: string;
  doctorRegNo: string;
  patientName: string;
  patientAddress: string;
  pharmacist: string; // resolved name, or "" when unresolved
}

/** Client filter: by schedule ("" = all) and a free-text query over drug / doctor / patient. */
export function filterH1Rows(rows: H1Row[], schedule: string, query: string): H1Row[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (schedule && r.schedule !== schedule) return false;
    if (!q) return true;
    return r.drugName.toLowerCase().includes(q) || r.doctorName.toLowerCase().includes(q) || r.patientName.toLowerCase().includes(q);
  });
}

/** ISO timestamp → 'DD-MM-YYYY' for the register. */
export function regDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}-${m}-${y}` : iso.slice(0, 10);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat, serial-numbered CSV of the register. */
export function h1RegisterToCsv(rows: H1Row[]): string {
  const head = ["sl", "date", "drug", "schedule", "qty", "batch", "expiry", "doctor", "doctor_reg", "patient", "patient_address", "pharmacist"];
  const body = rows.map((r, i) => [
    i + 1,
    regDate(r.soldAt),
    r.drugName,
    r.schedule,
    r.qty,
    r.batchNo,
    r.expiry,
    r.doctorName,
    r.doctorRegNo,
    r.patientName,
    r.patientAddress,
    r.pharmacist,
  ]);
  return [head, ...body].map((c) => c.map(csvCell).join(",")).join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface H1RegisterHeader {
  shopName: string;
  gstin: string;
  licenses: string;
  range: string;
}

/** A self-contained, printable A4-landscape register document for the drug inspector. */
export function h1RegisterHtml(rows: H1Row[], header: H1RegisterHeader): string {
  const body = rows
    .map(
      (r, i) => `<tr>
      <td>${i + 1}</td><td>${esc(regDate(r.soldAt))}</td><td>${esc(r.drugName)}</td><td>${esc(r.schedule)}</td>
      <td class="r">${r.qty}</td><td>${esc(r.batchNo)}</td><td>${esc(r.expiry)}</td>
      <td>${esc(r.doctorName)}${r.doctorRegNo ? `<div class="sub">Reg: ${esc(r.doctorRegNo)}</div>` : ""}</td>
      <td>${esc(r.patientName)}${r.patientAddress ? `<div class="sub">${esc(r.patientAddress)}</div>` : ""}</td>
      <td>${esc(r.pharmacist)}</td></tr>`,
    )
    .join("");
  const idLine = [header.gstin && `GSTIN: ${esc(header.gstin)}`, header.licenses && esc(header.licenses)].filter(Boolean).join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Schedule H1/X register</title>
<style>@page{size:A4 landscape;margin:10mm}
body{font:11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;color:#000;margin:0}
h1{font-size:15px;margin:0 0 2px}.meta{font-size:10px;color:#333}
.head{border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-end}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:3px 5px;vertical-align:top;text-align:left}
th{background:#eee;font-size:9px;text-transform:uppercase}.r{text-align:right}.sub{font-size:9px;color:#555}
.foot{margin-top:10px;font-size:10px;color:#444;display:flex;justify-content:space-between}
@media print{.noprint{display:none}}</style></head>
<body>
<div class="head">
  <div><h1>${esc(header.shopName)}</h1><div class="meta">${idLine}</div></div>
  <div class="meta"><strong>Schedule H1 / X dispensing register</strong><br>${esc(header.range)} · ${rows.length} entries</div>
</div>
<table><thead><tr><th>Sl</th><th>Date</th><th>Drug</th><th>Sch</th><th class="r">Qty</th><th>Batch</th><th>Expiry</th><th>Prescriber</th><th>Patient</th><th>Pharmacist</th></tr></thead>
<tbody>${body || '<tr><td colspan="10" style="text-align:center;color:#888;padding:14px">No H1/X dispensing in this range.</td></tr>'}</tbody></table>
<div class="foot"><span>Maintained under the Drugs &amp; Cosmetics Rules (Schedule H1). Retain 3 years.</span><span>Pharmacist signature: ____________________</span></div>
<button class="noprint" onclick="window.print()" style="position:fixed;top:8px;right:8px;padding:6px 12px">Print / Save PDF</button>
<script>window.onload=function(){window.focus();window.print();};</script>
</body></html>`;
}

/** Open the register in a new window and fire the print dialog (save-as-PDF). */
export function printH1Register(html: string): void {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
