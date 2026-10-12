#!/usr/bin/env python3
"""WCAG 2.1 contrast check for Salt's tokens, light and dark, plus the dash rule.

Reads the real values from apps/web/src/index.css (:root and .dark), so a change there cannot
drift from the figures in knowledge/design.md. Every ratio the doc states is recomputed and
the doc must contain the computed figure, so a stale figure fails. It also fails on any en or em
dash (U+2013, U+2014) in the design docs or in a user-facing string under apps/web/src.

Run: python3 knowledge/contrast.py     Exit status 1 on any failure.
Targets: text 4.5, control borders, focus rings and meaningful graphics 3.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
css = open(os.path.join(ROOT, "apps", "web", "src", "index.css"), encoding="utf-8").read()
doc = open(os.path.join(HERE, "design.md"), encoding="utf-8").read()


def block(selector):
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", css, re.S)
    return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", m.group(1)))


def resolve(tokens):
    out = dict(tokens)
    for _ in range(4):
        for k, v in out.items():
            m = re.fullmatch(r"var\(--([a-z0-9-]+)\)", v.strip())
            if m and m.group(1) in out:
                out[k] = out[m.group(1)]
    return {k: v.strip() for k, v in out.items()}


light_raw = block(":root")
light = resolve(light_raw)
dark = resolve({**light_raw, **block(".dark")})


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


count = fails = 0


def row(label, fg, bg, target, stated=False):
    global count, fails
    r = ratio(fg, bg)
    fig = f"{r:.2f}"
    ok = r >= target
    in_doc = (not stated) or f"{fig}:1" in doc
    count += 1
    fails += (not ok) + (not in_doc)
    print(f"{'PASS' if ok else 'FAIL'}  {label:60s} {fg} on {bg} = {fig}  (>= {target})" + ("" if in_doc else f"   FAIL: doc does not state {fig}:1"))


for name, t in (("LIGHT", light), ("DARK", dark)):
    print(f"--- {name}")
    surfaces = ("background", "surface", "surface-2")
    for s in surfaces:
        row(f"text-primary on {s}", t["text-primary"], t[s], 4.5)
        row(f"text-secondary on {s}", t["text-secondary"], t[s], 4.5)
        row(f"text-tertiary on {s}", t["text-tertiary"], t[s], 4.5)
    for s in surfaces:
        row(f"control border on {s} (3:1)", t["control"], t[s], 3.0, stated=True)
    for s in surfaces:
        row(f"focus ring on {s} (3:1)", t["focus-ring"], t[s], 3.0, stated=(s == "surface-2"))
    row("action-primary-text on action-primary", t["action-primary-text"], t["action-primary"], 4.5)
    row("action-primary-text on action-primary-hover", t["action-primary-text"], t["action-primary-hover"], 4.5)
    row("action-secondary-text on action-secondary", t["action-secondary-text"], t["action-secondary"], 4.5)
    row("action-secondary-text on action-secondary-hover", t["action-secondary-text"], t["action-secondary-hover"], 4.5)
    for st in ("success", "warning", "danger", "info"):
        row(f"{st} on {st}-bg (badge, tint)", t[st], t[f"{st}-bg"], 4.5)
        row(f"{st} on background (text)", t[st], t["background"], 4.5)
dark_toast = dark["surface"]
print("--- Dots and accents on the dark toast surface (graphics, 3:1)")
for st in ("success", "warning", "danger"):
    row(f"{st}-on-dark on dark surface", light[f"{st}-on-dark"], dark_toast, 3.0)

print("--- Dash rule (no U+2013 or U+2014 in the design docs or user-facing copy)")


def user_facing(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?<![:\"'\w])//[^\n]*", "", text)


dash_files = [os.path.join(ROOT, f) for f in ("design.md", "salt-design-system.html", "knowledge/design.md", "wiki/architecture/design-system.md")]
for base, _, files in os.walk(os.path.join(ROOT, "wiki", "design")):
    dash_files += [os.path.join(base, f) for f in files if f.endswith((".md", ".html"))]
for base, _, files in os.walk(os.path.join(ROOT, "apps", "web", "src")):
    dash_files += [os.path.join(base, f) for f in files if f.endswith((".ts", ".tsx"))]
dashes = []
for path in dash_files:
    text = open(path, encoding="utf-8").read()
    if path.endswith((".ts", ".tsx")):
        text = user_facing(text)
    for line in text.split("\n"):
        if "\u2013" in line or "\u2014" in line:
            dashes.append(f"{os.path.relpath(path, ROOT)}: {line.strip()[:70]}")
count += 1
fails += bool(dashes)
print(f"{'FAIL' if dashes else 'PASS'}  no en or em dash in {len(dash_files)} doc and source files ({len(dashes)} found)")
for line in dashes[:10]:
    print("      " + line)

print(f"\n{count - fails} of {count} checks pass")
print("ALL PASS" if not fails else "SOME FAIL")
sys.exit(1 if fails else 0)
