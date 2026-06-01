#!/usr/bin/env python3
"""
extract_pmbjp.py — parse the Jan Aushadhi (PMBJP) "Product List" PDF into
inputs/pmbjp.csv (an input for build_seed.py). License-clean: PMBJP is a
Government of India / PMBI publication (GODL-India). Raw PDF is gitignored —
run locally against your downloaded copy, then commit the generated CSV.

Usage:  python3 extract_pmbjp.py [path/to/ProductList.pdf]
Requires `pdfplumber` (pip install --user pdfplumber).

Layout: a 5-column table (Sr.No | Drug Code | Generic Name | Unit Size | MRP).
Generic names wrap over several lines while Sr.No/Code/Unit/MRP are vertically
centred on the row, so each text line is assigned to a record by the midpoint
between consecutive Sr.No anchors. Generic Name -> name+salt; Unit Size -> pack.
MRP is captured for reference but master_items has no price column yet (v2), so
it is written to a trailing column the seed builder ignores.
"""
import csv
import re
import sys
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
OUT = HERE / "inputs" / "pmbjp.csv"
CANDIDATES = [
    HERE.parent.parent.parent / "Drug reference" / "Product List (1).pdf",
    HERE.parent.parent.parent / "Drug reference" / "Product List.pdf",
    HERE / "pmbjp.pdf",
]
# Column splits by word x0 (from the header geometry).
SRNO_MAX, CODE_MAX, NAME_MAX, UNIT_MAX = 140, 230, 378, 472
HEADER_BOTTOM = 40  # skip the repeated page header (top ~20)


def find_pdf(argv) -> Path:
    if len(argv) > 1:
        return Path(argv[1]).expanduser()
    for c in CANDIDATES:
        if c.exists():
            return c
    sys.exit("PMBJP PDF not found — pass the path: python3 extract_pmbjp.py <ProductList.pdf>")


def col(x0: float) -> str:
    if x0 < SRNO_MAX: return "srno"
    if x0 < CODE_MAX: return "code"
    if x0 < NAME_MAX: return "name"
    if x0 < UNIT_MAX: return "unit"
    return "mrp"


def page_records(page):
    words = [w for w in page.extract_words() if w["top"] >= HEADER_BOTTOM]
    if not words:
        return
    # Sr.No anchors: integer tokens in the leftmost column, by vertical position.
    anchors = sorted(
        (w["top"] for w in words if col(w["x0"]) == "srno" and re.fullmatch(r"\d+", w["text"])),
    )
    if not anchors:
        return
    # Midpoint spans: record k owns lines between the mid-points of its neighbours.
    bounds = [HEADER_BOTTOM] + [(anchors[i] + anchors[i + 1]) / 2 for i in range(len(anchors) - 1)] + [1e9]
    for k in range(len(anchors)):
        lo, hi = bounds[k], bounds[k + 1]
        cells = {"name": [], "unit": [], "mrp": []}
        for w in sorted((w for w in words if lo <= w["top"] < hi), key=lambda w: (w["top"], w["x0"])):
            c = col(w["x0"])
            if c in cells:
                cells[c].append(w["text"])
        name = re.sub(r"\s+", " ", " ".join(cells["name"])).strip()
        if name:
            yield name, " ".join(cells["unit"]).strip(), " ".join(cells["mrp"]).strip()


def main(argv):
    pdf_path = find_pdf(argv)
    rows, seen = [], set()
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for name, unit, mrp in page_records(page):
                key = re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                rows.append((name, unit, mrp))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "salt", "pack", "hsn", "schedule", "ayush", "gst_rate_class", "source", "mrp_rs"])
        for name, unit, mrp in rows:
            w.writerow([name, name, unit, "3004", "", "0", "std", "pmbjp", mrp])

    print(f"wrote {OUT.relative_to(HERE)} — {len(rows)} products")
    print("  samples:", [r[0][:40] for r in rows[:3]])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
