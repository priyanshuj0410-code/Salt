#!/usr/bin/env python3
"""
build_seed.py — generate supabase/migrations/0047_seed_master_items.sql for SALT-081.

Reads license-clean inputs (curated CSV + Schedule H1/X keyword lists) and emits an
idempotent seed migration for the global `master_items` reference table. Stdlib only
(no PDF libs needed for the curated path).

To SCALE past the curated starter: parse the open government PDFs locally — NLEM 2022,
Jan Aushadhi (PMBJP) product list, CDSCO approved-drugs/FDC lists — into a CSV with the
same columns as drugs.csv (schedule may be left blank; it is then derived from the
H1/X keyword lists) and drop it in as inputs/parsed_*.csv. The .gov.in sites block
datacenter IPs (HTTP 403), so download + parse from a normal connection, not CI.
Sources are Government of India works (GODL-India) — attribute, do not commit raw PDFs.

Usage:  python3 build_seed.py
"""
import csv
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUTS = HERE / "inputs"
OUT = HERE.parent.parent / "migrations" / "0047_seed_master_items.sql"

# Current-era (post 22-Sep-2025) snapshot rate per class — must match 0046_gst_rate_schedule.sql.
CLASS_RATE = {"std": 5, "ayush": 5, "nil": 0, "gst18": 18}


def norm(name: str) -> str:
    """Match the canonical SQL norm: lower(), strip anything outside [a-z0-9 ]."""
    return re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()


def load_keywords(fname: str) -> list[str]:
    out = []
    p = INPUTS / fname
    if not p.exists():
        return out
    with p.open(newline="") as f:
        for row in csv.DictReader(f):
            mol = (row.get("molecule") or "").strip()
            if mol and not mol.startswith("#"):
                out.append(mol.lower())
    return out


H1 = load_keywords("schedule_h1.csv")
X = load_keywords("schedule_x.csv")


def derive_schedule(name: str, salt: str) -> str:
    """For rows without an explicit schedule (e.g. PDF-parsed): X > H1 > H default."""
    hay = f"{name} {salt}".lower()
    if any(k in hay for k in X):
        return "X"
    if any(k in hay for k in H1):
        return "H1"
    return "H"


# --- 8-digit HSN by drug class (best-effort, under headings 3004 / 3005). Reconcile with a CA. ---
_AYUSH_KW = ("ayurved", "polyherbal", "herbal", "unani", "siddha", "homeop", "bhasma", "churna")
_CORTICOSTEROID_KW = ("prednisolone", "prednisone", "methylprednisolone", "dexamethasone", "betamethasone",
                      "hydrocortisone", "triamcinolone", "deflazacort", "clobetasol", "mometasone",
                      "fluticasone", "budesonide", "beclometasone", "beclomethasone", "fluocinolone")
_HORMONE_KW = ("thyroxine", "levothyroxine", "liothyronine", "testosterone", "progesterone", "estradiol",
               "estrogen", "oestrogen", "oxytocin", "somatropin", "glucagon", "ethinylestradiol",
               "ethinyl estradiol", "levonorgestrel", "desogestrel", "norethisterone", "medroxyprogesterone")
_PENICILLIN_KW = ("amoxicillin", "amoxycillin", "ampicillin", "cloxacillin", "piperacillin", "penicillin")
_ANTIBIOTIC_KW = ("azithromycin", "erythromycin", "clarithromycin", "roxithromycin", "cefixime", "cefpodoxime",
                  "cefuroxime", "ceftriaxone", "cefoperazone", "cephalexin", "cefadroxil", "cefdinir",
                  "ceftazidime", "cefepime", "levofloxacin", "ofloxacin", "ciprofloxacin", "moxifloxacin",
                  "norfloxacin", "doxycycline", "minocycline", "tetracycline", "gentamicin", "amikacin",
                  "linezolid", "clindamycin", "vancomycin", "meropenem", "imipenem", "faropenem", "rifaximin")
_ANTIMALARIAL_KW = ("artemether", "lumefantrine", "artesunate", "arteether", "chloroquine",
                    "hydroxychloroquine", "primaquine", "mefloquine", "quinine")
_VITAMIN_KW = ("vitamin", "multivitamin", "cholecalciferol", "calcitriol", "ergocalciferol", "methylcobalamin",
               "mecobalamin", "cyanocobalamin", "thiamine", "riboflavin", "pyridoxine", "folic acid",
               "ascorbic", "tocopher", "niacinamide", "nicotinamide", "b-complex", "b complex")


def classify_hsn(name: str, salt: str, base_hsn: str, ayush: bool) -> str:
    """Best-effort 8-digit HSN from the drug class. Heading 3004 (medicaments) sub-classifies by
    class; 3005 = dressings; any other chapter (devices 90xx, cosmetics, food supplements) is left
    as supplied. Keyword-based and best-effort — reconcile with a CA before statutory use."""
    h = (base_hsn or "").replace(".", "").strip()
    hay = f"{name} {salt}".lower()
    if h.startswith("3005"):
        return "30051090" if any(k in hay for k in ("medicat", "adhesive", "band aid", "bandaid")) else "30059090"
    if h and not h.startswith("3004"):
        return h  # not a medicament heading — leave the supplied code (devices, cosmetics, etc.)
    if ayush or any(k in hay for k in _AYUSH_KW):
        return "30049011"  # Ayurvedic system medicaments
    if "insulin" in hay:
        return "30043110"  # insulin
    if any(k in hay for k in _CORTICOSTEROID_KW):
        return "30043200"  # containing corticosteroid hormones
    if any(k in hay for k in _HORMONE_KW):
        return "30043900"  # other hormones
    if any(k in hay for k in _PENICILLIN_KW):
        return "30041020"  # penicillins (amoxicillin / ampicillin group)
    if any(k in hay for k in _ANTIBIOTIC_KW):
        return "30042099"  # other antibiotics
    if any(k in hay for k in _ANTIMALARIAL_KW):
        return "30046000"  # antimalarials
    if any(k in hay for k in _VITAMIN_KW):
        return "30045090"  # provitamins / vitamins
    return "30049099"  # other medicaments — the residual for the bulk of branded formulations


def esc(v: str) -> str:
    return v.replace("'", "''")


def sql_val(v):
    if v is None or v == "":
        return "null"
    return f"'{esc(str(v))}'"


def read_rows():
    """Yield normalized master rows from every inputs/*.csv that has a 'name' column."""
    for csv_path in sorted(INPUTS.glob("*.csv")):
        with csv_path.open(newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or "name" not in reader.fieldnames:
                continue  # keyword lists (schedule_h1/x) are skipped here
            for row in reader:
                name = (row.get("name") or "").strip()
                if not name or name.startswith("#"):
                    continue
                salt = (row.get("salt") or "").strip()
                schedule = (row.get("schedule") or "").strip() or derive_schedule(name, salt)
                rate_class = (row.get("gst_rate_class") or "std").strip() or "std"
                ayush = (row.get("ayush") or "0").strip() in ("1", "true", "yes")
                yield {
                    "name": name,
                    "salt": salt,
                    "manufacturer": (row.get("manufacturer") or "").strip(),
                    "pack": (row.get("pack") or "").strip(),
                    "hsn": classify_hsn(name, salt, (row.get("hsn") or "").strip(), ayush),
                    "schedule": schedule,
                    "ayush": ayush,
                    "gst_rate_class": rate_class,
                    "gst_rate": CLASS_RATE.get(rate_class, 5),
                    "source": (row.get("source") or "curated-v1").strip(),
                    "norm": norm(name),
                }


def main():
    seen, rows = set(), []
    for r in read_rows():
        if not r["norm"] or r["norm"] in seen:
            continue
        seen.add(r["norm"])
        rows.append(r)
    rows.sort(key=lambda r: r["name"])

    lines = [
        "-- 0047: Seed the national drug master (master_items) — SALT-081.",
        "-- GENERATED by supabase/seeds/master-items/build_seed.py — edit the inputs/ CSVs, not this file.",
        "-- License-clean molecule-level data (Government of India / GODL-India + curated facts).",
        "-- Identity + HSN + schedule + GST rate class; manufacturer/barcode/MRP left to GRN.",
        "-- gst_rate is the current snapshot; the date-effective series lives in gst_rate_schedule (0046).",
        "-- NOTE: schedule / HSN / GST are a best-effort starter — have a pharmacist reconcile against",
        "--       NLEM, GSR 588(E) (H1), Schedule X and the live CBIC notification before compliance use.",
        "-- Run in the Supabase SQL editor (after 0046).",
        "",
        "alter table public.master_items add column if not exists gst_rate_class text;",
        "create unique index if not exists master_items_norm_key on public.master_items (norm);",
        "",
        "insert into public.master_items",
        "  (name, salt, manufacturer, pack, hsn, gst_rate, gst_rate_class, schedule, norm, source)",
        "values",
    ]
    values = []
    for r in rows:
        values.append(
            "  ("
            f"{sql_val(r['name'])}, {sql_val(r['salt'])}, {sql_val(r['manufacturer'])}, "
            f"{sql_val(r['pack'])}, {sql_val(r['hsn'])}, {r['gst_rate']}, "
            f"{sql_val(r['gst_rate_class'])}, {sql_val(r['schedule'])}, {sql_val(r['norm'])}, {sql_val(r['source'])}"
            ")"
        )
    lines.append(",\n".join(values))
    # Upsert (not do-nothing): re-running the regenerated seed syncs corrected
    # schedule/HSN/GST onto existing rows by norm. id is stable, so items.master_item_id
    # FKs survive. The inputs/ CSVs are the source of truth (manual DB edits are not).
    lines.append(
        "on conflict (norm) do update set\n"
        "  name = excluded.name, salt = excluded.salt, manufacturer = excluded.manufacturer,\n"
        "  pack = excluded.pack, hsn = excluded.hsn, gst_rate = excluded.gst_rate,\n"
        "  gst_rate_class = excluded.gst_rate_class, schedule = excluded.schedule, source = excluded.source;"
    )
    lines.append("")

    OUT.write_text("\n".join(lines))

    # Summary for verification.
    by_sched, by_class = {}, {}
    for r in rows:
        by_sched[r["schedule"]] = by_sched.get(r["schedule"], 0) + 1
        by_class[r["gst_rate_class"]] = by_class.get(r["gst_rate_class"], 0) + 1
    print(f"wrote {OUT.relative_to(HERE.parent.parent.parent)} — {len(rows)} unique rows")
    print("  by schedule:", dict(sorted(by_sched.items())))
    print("  by gst_rate_class:", dict(sorted(by_class.items())))
    miss = sum(1 for r in rows if not r["hsn"])
    print(f"  rows missing hsn: {miss}")


if __name__ == "__main__":
    sys.exit(main())
