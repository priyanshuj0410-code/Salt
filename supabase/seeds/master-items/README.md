# master-items seed (SALT-081)

Generates the seed migration for the global drug reference table `master_items` from
**open, license-clean** sources. Brand/manufacturer/MRP are intentionally left empty —
those accrue per-shop via crowd-sourced GRN (the network-effects moat in the PRD).

## What this produces
`build_seed.py` reads the `inputs/` CSVs and writes
`supabase/migrations/0047_seed_master_items.sql` (idempotent: `on conflict (norm) do nothing`).
Companion infra migration: `supabase/migrations/0046_gst_rate_schedule.sql` (date-effective
GST rates + `gst_rate_for(class, date)`), hand-maintained.

```
python3 build_seed.py        # regenerate 0047 from inputs/
```

## Inputs (curated, committed)
- `inputs/drugs.csv` — curated common Indian molecules with `name, salt, pack, hsn, schedule,
  ayush, gst_rate_class, source`. The v1 starter.
- `inputs/schedule_h1.csv`, `inputs/schedule_x.csv` — molecule keyword lists; the ETL uses them
  to tag `schedule` on bulk rows that arrive without one.

## Scaling to the full national master (NLEM / Jan Aushadhi / CDSCO)
The bulk identity comes from these Government of India sources (all GODL-India — free use with
attribution; **do not commit the raw PDFs**, and **never** use scraped commercial catalogues like
1mg/PharmEasy — legal risk, per the PRD):

| Source | Supplies |
|---|---|
| NLEM 2022 (`cdsco.gov.in/.../nlem2022.pdf`) | molecule, strength, therapeutic category |
| Jan Aushadhi / PMBJP (`pmbi.co.in/ProductList.aspx`, ~2,439) | generic name, pack, MRP anchor |
| CDSCO approved new-drugs + FDC lists (`cdsco.gov.in/.../Approval_new/`) | approved-molecule breadth |
| CBIC GST schedule (HSN ch. 30/90) + Notif. 9/2025 nil list | `gst_rate_class` buckets (see 0046) |

**These sites return HTTP 403 to datacenter / CI IPs**, so download + parse from a normal
connection (e.g. `pdfplumber`/`camelot` locally). Emit a CSV with the same columns as `drugs.csv`
(leave `schedule` blank to auto-derive), drop it in as `inputs/parsed_<source>.csv`, and re-run
`build_seed.py`. Tag each row's `source` (e.g. `nlem-2022`, `pmbjp`, `cdsco-fdc`).

## ⚠️ Compliance caveat
`schedule`, `hsn`, and `gst_rate_class` in the curated starter are best-effort. Have a pharmacist
reconcile against NLEM, GSR 588(E) (Schedule H1), Schedule X (D&C Rules), and the live CBIC
notification before using this for statutory compliance or filings.
