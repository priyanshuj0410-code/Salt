#!/usr/bin/env python3
"""Build the de-identified brand -> composition master (brand_reference.csv).

Reads two per-SKU CSVs from a shop catalogue and emits one row per distinct
(cleaned brand, manufacturer, composition):

  enrichment.csv : key,name,salt,category,confidence   (the AI/web-verified facts)
  worklist.csv   : key,...,manufacturer,...            (supplies the manufacturer)

All consumer-specific data (stock, qty, pack size, codes, prices, raw SKU
strings) is dropped. Only public brand->molecule facts remain, so the output is
safe to commit; the *input* shop catalogue is not (keep it untracked).

`clean_brand` is the single source of truth for brand normalisation. The import /
enrichment path MUST call this same function so its keys line up with the master
(see README "How will imports use this"). Strength is KEPT (it disambiguates
compositions: ACITROM 2/3/4); dosage form, pack and quantity are stripped.

Usage:
    python3 build_brand_reference.py ENRICHMENT_CSV WORKLIST_CSV [OUT_CSV]
"""
import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent

# --- token vocab -----------------------------------------------------------
_TAB = {"TAB", "TABS", "TABLET", "TABLETS", "CAP", "CAPS", "CAPSULE", "CAPSULES"}
_LIQ = {"SYP", "SYRUP", "SUSP", "SUSPENSION", "SOLN", "SOLUTION", "LIQ", "LIQUID",
        "ELIXIR", "DROP", "DROPS", "DRP", "DROPLET"}
_INJ = {"INJ", "INJECTION", "VIAL", "VIALS", "AMP", "AMPULE", "AMPOULE", "PFS"}
_TOP = {"CREAM", "GEL", "OINT", "OINTMENT", "LOTION", "BALM", "PASTE", "SOAP",
        "WASH", "FACEWASH", "SHAMPOO", "SCRUB", "SERUM", "MASK", "FOAM"}
_OTH = {"SPRAY", "RESPULES", "ROTACAP", "ROTACAPS", "INHALER", "MDI", "PUFF",
        "PUFFS", "SACHET", "POWDER", "PWD", "GRANULES", "KIT", "PESSARY",
        "SUPPOSITORY", "ENEMA", "GARGLE", "MOUTHWASH", "PATCH", "OIL", "EXP",
        "CER", "REDIUSE", "REDIUSES", "CARTRIDGE", "CARTRIDGES",
        "SMARTULE", "SMARTULES", "COMBIPACK", "COMBIKIT"}
CUT = _TAB | _LIQ | _INJ | _TOP | _OTH          # a form/pack word ends the brand
KEEP = {"DT", "MD", "MT", "ODT", "SR", "XL", "CR", "ER", "OD", "LA", "HFA",
        "MR", "XR", "SL", "IR"}                  # release modifiers precede strength
ROUTE = {"EYE", "EAR", "NASAL", "ORAL", "VAGINAL", "RECTAL", "SKIN", "FACE", "OTIC"}
STOP = {"NEW", "MINI", "BABY", "DOMESTIC"}
UNITWORD = {"MG", "MCG", "GM", "GMS", "G", "KG", "ML", "IU", "L"}

# A unit-glued MASS dose is strength -> normalise to the bare number and KEEP it.
# Tolerates an apostrophe before the unit (2'MG), a quirk of these exports.
STRENGTH = re.compile(r"^(\d+(?:\.\d+)?)'?(MG|MCG|IU|G)$")
# A unit-glued VOLUME/WEIGHT is a pack size -> strip it.
PACKUNIT = re.compile(r"\d+(?:\.\d+)?(?:ML|GM|GMS|KG|L|MDI)$")
# Hyphen/space-glued trailing form word, e.g. NUROKIND-INJ -> NUROKIND.
TAILFORM = re.compile(r"[-\s]+(?:" + "|".join(sorted(CUT, key=len, reverse=True)) + r")$")

MFR_FIX = {"Stancare.": "Stancare", "Stancare...": "Stancare",
           "Life Star2": "Life Star", "Enter0": "Entero"}

_ORDER = {"high-verified": 0, "high": 1, "med": 2, "low": 3}


def norm_key(s: str) -> str:
    """The join key used everywhere: lowercase, drop all non-alphanumerics.

    Byte-identical to masterEnrich.ts `key()` so brand_key matches on both sides.
    """
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def clean_brand(name: str) -> str:
    """Strip dosage form / pack / quantity from a raw SKU name; keep strength."""
    s = re.sub(r"[«»®™]", " ", name.upper()).replace('"', " ").replace("’", "'")
    s = re.sub(r"[\(\)\[\]\{\}]", " ", s)              # unwrap brackets
    s = re.sub(r"-(?=\d)", " ", s)                     # split a hyphen-glued strength: AMPANEL-2MG
    s = re.sub(r"(?<=\D)/|/(?=\D)", " ", s)            # slash between non-digits -> space (keep 10/2/500)
    s = re.sub(r"(?<=\D)\.|\.(?=\D)", " ", s)          # period between non-digits -> space (keep 0.5)
    toks = [t for t in re.split(r"[\s,\\]+", s) if t]
    out = []
    for t in toks:
        base = t.strip("'.")
        if base in KEEP:
            out.append(base)
            continue
        if base in CUT:                                # a form word ends the brand
            break
        m = STRENGTH.match(base)
        if m:                                          # 2MG -> 2, 0.2MG -> 0.2 (KEEP)
            out.append(m.group(1))
            continue
        out.append(t)

    def junk(tok: str) -> bool:
        u = tok.strip("'.")
        if "*" in u:                                   # any pack notation: 1*5S, 1ML*5S, 5*3ML
            return True
        if u in ROUTE or u in STOP or u in UNITWORD:   # route word / stop word / standalone unit
            return True
        if PACKUNIT.fullmatch(u):                      # 75GM, 100ML pack size
            return True
        if re.fullmatch(r"\d+(?:\.\d+)?'?(?:S|TAB|TABS|CAP|CAPS)", u):  # 30'S, 10TAB
            return True
        if re.fullmatch(r"\d+X\d+(?:ML|GM|GMS|MG|MCG|KG|G|L)?", u):  # 10X2, 5X2ML
            return True
        return False

    while out and junk(out[-1]):
        out.pop()
    brand = re.sub(r"\s+", " ", " ".join(out)).strip(" '-.")
    for _ in range(2):                                  # NUROKIND-INJ -> NUROKIND
        brand = TAILFORM.sub("", brand)
    brand = re.sub(r"(\d)\s*'?\s*(?:MG|MCG|GM|GMS|ML|IU|KG|G|L)\b", r"\1", brand)  # 2/1'MG -> 2/1
    brand = re.sub(r"\s*-\s+|\s+-\s*", " ", brand)      # drop dangling hyphens: R- 2 -> R 2
    brand = re.sub(r"\s{2,}", " ", brand).strip(" '-.")
    if not brand:                                       # fell through to nothing -> last resort
        brand = re.sub(r"\s*\d+'?S?\s*$", "", name.upper()).strip()
    return brand


def canon_comp(c: str):
    """Strength-INCLUSIVE canonical form of a composition: drop parentheticals,
    lowercase, split a combo and sort it. Two compositions share this only when
    they are the same molecules at the same strength written differently (case,
    word order, a descriptive '(...)'). NEVER collapses different strengths
    (e.g. '3 lakh IU' vs '6 lakh IU') because the digits are kept in norm_key."""
    c = re.sub(r"\(.*?\)", " ", c)
    parts = [norm_key(p) for p in re.split(r"[+/,&]| and ", c)]
    return tuple(sorted(p for p in parts if p))


def build(enrichment_csv: str, worklist_csv: str, out_csv: str) -> None:
    mfr = {}
    for r in csv.DictReader(open(worklist_csv)):
        m = (r.get("manufacturer") or "").strip()
        mfr[r["key"]] = MFR_FIX.get(m, m)

    best = {}
    for r in csv.DictReader(open(enrichment_csv)):
        brand = clean_brand(r["name"])
        bkey = norm_key(brand)
        manufacturer = mfr.get(r["key"], "")
        comp = (r.get("salt") or "").strip()
        row = {
            "brand_key": bkey,
            "brand": brand,
            "manufacturer": manufacturer,
            "composition": comp,
            "category": (r.get("category") or "").strip(),
            "confidence": (r.get("confidence") or "").strip(),
        }
        k = (bkey, norm_key(manufacturer), comp)
        if k not in best or _ORDER.get(row["confidence"], 9) < _ORDER.get(best[k]["confidence"], 9):
            best[k] = row

    # Consolidate pure text-variants of the same composition (safe; strength-aware).
    merged = {}
    for row in best.values():
        ck = (row["brand_key"], norm_key(row["manufacturer"]), canon_comp(row["composition"]))
        keep = merged.get(ck)
        if (keep is None
                or _ORDER.get(row["confidence"], 9) < _ORDER.get(keep["confidence"], 9)
                or (_ORDER.get(row["confidence"], 9) == _ORDER.get(keep["confidence"], 9)
                    and len(row["composition"]) > len(keep["composition"]))):
            merged[ck] = row

    # Merge curated brands absent from the shop catalogue (reseed-safe): web-verified fixes
    # for SKUs that never appeared in the source worklist. Same dedup/precedence as above.
    curated = HERE / "brand_curated.csv"
    if curated.exists():
        for r in csv.DictReader(open(curated)):
            brand = clean_brand(r["brand"])
            m = (r.get("manufacturer") or "").strip()
            row = {
                "brand_key": norm_key(brand),
                "brand": brand,
                "manufacturer": MFR_FIX.get(m, m),
                "composition": (r.get("composition") or "").strip(),
                "category": (r.get("category") or "").strip(),
                "confidence": (r.get("confidence") or "med").strip(),
            }
            ck = (row["brand_key"], norm_key(row["manufacturer"]), canon_comp(row["composition"]))
            keep = merged.get(ck)
            if keep is None or _ORDER.get(row["confidence"], 9) < _ORDER.get(keep["confidence"], 9):
                merged[ck] = row

    rows = sorted(merged.values(), key=lambda x: (x["brand_key"], x["composition"]))
    with open(out_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["brand_key", "brand", "manufacturer",
                                           "composition", "category", "confidence"])
        w.writeheader()
        w.writerows(rows)

    # --- report -----------------------------------------------------------
    bykey = defaultdict(set)
    for r in rows:
        bykey[(r["brand_key"], norm_key(r["manufacturer"]))].add(r["composition"])
    ambig = {k: c for k, c in bykey.items() if len(c) > 1}
    ambig_rows = sum(len(bykey[k]) for k in ambig)
    blank = sum(1 for r in rows if not r["composition"])
    print(f"wrote {out_csv}")
    print(f"  rows:                 {len(rows)}")
    print(f"  distinct brand_key:   {len({r['brand_key'] for r in rows})}")
    print(f"  blank composition:    {blank}")
    print(f"  ambiguous keys/rows:  {len(ambig)} / {ambig_rows}")
    print(f"  confidence:           {dict(Counter(r['confidence'] for r in rows))}")
    if ambig:
        print("  remaining ambiguous (sample):")
        for k in list(ambig)[:8]:
            print(f"    {k[0]:<18} {sorted(bykey[k])}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: build_brand_reference.py ENRICHMENT_CSV WORKLIST_CSV [OUT_CSV]")
    out = sys.argv[3] if len(sys.argv) > 3 else "brand_reference.csv"
    build(sys.argv[1], sys.argv[2], out)
