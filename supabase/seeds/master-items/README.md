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

## `brand_reference.csv` — the growable brand→molecule master
A **de-identified, brand-level** reference mapping a marketed brand to its composition,
therapeutic category, and manufacturer. It complements the molecule-level `master_items` seed:
that seed is generic identity (license-clean, government-sourced); this is the *brand→generic*
crosswalk that lets us recognise a shop's "LONAZEP 0.5" as `Clonazepam 0.5mg`.

**Provenance & privacy.** Derived from one real shop's catalogue by AI-inferring each brand's
salt + category (web-verified where not ~100% certain), then stripping **all** consumer-specific
data — stock, quantities, pack sizes, raw SKU strings, internal codes, prices. Only public
brand→molecule facts remain. It is therefore safe to commit (unlike the raw `Saral/` catalogue,
which is untracked customer data and must never be committed). No 1mg/PharmEasy scrape was used —
brand→molecule inference + WebSearch verification only.

**Schema** (`brand_key,brand,manufacturer,composition,category,confidence`):
| Column | Meaning |
|---|---|
| `brand_key` | normalised join key: `re.sub(r'[^a-z0-9]','', brand.lower())` |
| `brand` | cleaned brand name — strength **kept** (it disambiguates), form/pack/qty **stripped** |
| `manufacturer` | standardised maker (disambiguates same-stem brand name-traps across companies) |
| `composition` | active molecule(s) + strength, e.g. `Voglibose 0.2mg + Repaglinide 1mg` |
| `category` | therapeutic class, e.g. `Antidiabetic`, `Cardiovascular (Beta-blocker)` |
| `confidence` | `high-verified` (web-confirmed) · `high` (confident brand-stem inference) · `med` (reasonable, unverified) · `low` (genuinely unknown → `composition` left blank) |

Current size: **4,062 brand rows** (3,949 distinct brand+manufacturer), composition filled on
4,040; confidence `high-verified` 698 / `high` 3,191 / `med` 150 / `low` 23.

Strength is preserved **in the key** (`ACITROM 2MG/3MG/4MG` → `acitrom2/3/4`, not a single
colliding `acitrom`) so multi-strength brands stay distinct. ~96 keys still carry >1 composition;
those are legitimately different strengths/forms of one brand (e.g. `azee` 100 vs 200 mg/5ml,
`acnestar` gel vs face-wash) — at match time the incoming SKU's own strength/form selects the row.

**NOT auto-consumed by `build_seed.py`.** It lives **outside `inputs/`** on purpose — `build_seed.py`
globs `inputs/*.csv` and only keeps `name/salt/pack/hsn/...`, which would drop `category`/`confidence`
and inject brand rows into the molecule seed. Wiring it in (e.g. as a brand-alias table) is a
deliberate, separate step — don't do it by dropping this file into `inputs/`.

**How to grow it.** Don't hand-edit the CSV — regenerate it with `build_brand_reference.py`, which
is the single source of truth for brand cleaning + dedup:

```
python3 build_brand_reference.py ENRICHMENT_CSV WORKLIST_CSV [OUT_CSV]
#   ENRICHMENT_CSV : key,name,salt,category,confidence   (the AI/web-verified facts)
#   WORKLIST_CSV   : key,...,manufacturer,...            (supplies the manufacturer)
```

To add a new shop: enrich its catalogue into those two CSV shapes (AI-infer salt + category,
WebSearch anything < ~100% certain, mark `confidence`, blank `composition` + `low` if truly
unknown), concatenate with the existing inputs, and re-run. The script:
1. `clean_brand()` — upper-cases, **keeps** strength (normalising `2MG`/`0.2MG` → `2`/`0.2`) and
   release modifiers (`SR/XL/OD/DT`), and strips dosage form / pack / quantity (`TAB`, `30'S`,
   `1ML*5S`, `SMARTULES`, …). This is the **same** function the import/enrichment matcher must call
   so `brand_key`s line up on both sides.
2. Standardises the manufacturer (`MFR_FIX`) — the tie-breaker for shared brand stems.
3. De-dupes on **(`brand_key`, normalised `manufacturer`, `composition`)**, keeping best confidence
   (`high-verified` > `high` > `med` > `low`), then consolidates pure text-variants of one
   composition (parenthetical / case / word-order) while **never** merging different strengths.

Multiple rows for one brand+mfr are expected and fine — they're different strengths/forms.
