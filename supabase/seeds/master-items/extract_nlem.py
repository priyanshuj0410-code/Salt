#!/usr/bin/env python3
"""
extract_nlem.py — parse the NLEM 2022 PDF's "Alphabetical List of Medicines" into
inputs/nlem2022.csv (an input for build_seed.py). License-clean: NLEM is a Government
of India publication (GODL-India). The raw PDF is NOT committed (gitignored); run this
locally against your downloaded copy, then commit the generated CSV.

Usage:  python3 extract_nlem.py [path/to/nlem2022.pdf]
Default path: "../../../Drug reference/nlem2022.pdf" relative to this script, then
a few common fallbacks. Requires `pdftotext` (poppler) on PATH.

Coverage note: the alphabetical list gives canonical NLEM medicine NAMES (the molecule
master). Per-item HSN/strength live in the categorized sections — here HSN defaults to
'3004' (finished medicament) and schedule is left blank for build_seed.py to derive
(H1/X by keyword, else H). Reconcile against the categorized list before compliance use.
"""
import csv
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "inputs" / "nlem2022.csv"
# Alphabetical list spans PDF pages 85-101 (doc pages 84-100).
PAGE_FROM, PAGE_TO = 85, 101

CANDIDATES = [
    HERE.parent.parent.parent / "Drug reference" / "nlem2022.pdf",
    HERE / "nlem2022.pdf",
    Path.home() / "Salt" / "Drug reference" / "nlem2022.pdf",
]

BOILERPLATE = re.compile(
    r"^(Page \d+ of \d+|National List of Essential|Alphabetical List|of Medicines in|NLEM 2022)\b",
    re.I,
)
NUMBERED = re.compile(r"^\s*(\d+)\.\s+(.*\S)\s*$")
SUBBULLET = re.compile(r"^\s*[a-z]\)\s")


def clean(name: str) -> str:
    name = re.sub(r"\s*\([A-D]\)", "", name)   # drop FDC position markers " (A)", " (B)"
    name = name.replace("–", "-").replace("–", "-")
    name = re.sub(r"\s+", " ", name).strip()
    return name


def find_pdf(argv) -> Path:
    if len(argv) > 1:
        return Path(argv[1]).expanduser()
    for c in CANDIDATES:
        if c.exists():
            return c
    sys.exit("NLEM PDF not found — pass the path: python3 extract_nlem.py <nlem2022.pdf>")


def main(argv):
    pdf = find_pdf(argv)
    if not pdf.exists():
        sys.exit(f"not found: {pdf}")
    text = subprocess.run(
        ["pdftotext", "-f", str(PAGE_FROM), "-l", str(PAGE_TO), str(pdf), "-"],
        check=True, capture_output=True, text=True,
    ).stdout

    entries: list[str] = []
    current = None
    for line in text.splitlines():
        if not line.strip() or BOILERPLATE.match(line.strip()):
            continue
        m = NUMBERED.match(line)
        if m:
            if current:
                entries.append(current)
            current = m.group(2)
        elif SUBBULLET.match(line):
            continue  # dosage-form variant of the current entry
        elif current is not None:
            current += " " + line.strip()  # wrapped continuation
    if current:
        entries.append(current)

    rows, seen = [], set()
    for raw in entries:
        name = clean(raw)
        key = re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()
        if not name or key in seen:
            continue
        seen.add(key)
        rows.append(name)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "salt", "pack", "hsn", "schedule", "ayush", "gst_rate_class", "source"])
        for name in rows:
            # identity-first: salt = molecule name; HSN default 3004; schedule derived downstream.
            w.writerow([name, name, "", "3004", "", "0", "std", "nlem-2022"])

    print(f"wrote {OUT.relative_to(HERE)} — {len(rows)} medicines")
    longest = sorted(rows, key=len, reverse=True)[:3]
    print("  longest names (sanity):", longest)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
