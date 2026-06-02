---
type: architecture
updated: 2026-06-02
tags: [catalogue, master-data, enrichment, hsn, brand-aliases]
---

# Catalogue & Drug Master

The catalogue module is the **master-data spine of Salt**: every other module (GRN, billing, GST, inventory, reports) reads from the org-scoped `items` table that this module manages. It also owns the **shared global drug reference** (`master_items` + `brand_aliases`) that all orgs draw on, and the enrichment pipeline that connects the two.

## Screens & flows

### `/catalog` — Catalogue list (SALT-079)

`CatalogPage.tsx` — the primary browse/search screen for an org's item catalogue.

| Feature | What it does |
|---|---|
| **Full-text search** | `searchCatalog()` ranks by name/salt/barcode match; debounced, client-side from the Zustand store |
| **Stat cards** | Total items · Items with salt filled · Unique HSN codes |
| **Fill from master** (`Sparkles`) | `planEnrichment()` → preview modal → `applyEnrich()`. Fills ONLY missing salt/HSN/GST from `master_items` + `brand_aliases`; never overwrites a value the shop already has |
| **Review salt** (`FlaskConical`) | `planSaltReplacements()` → per-item approve/skip. Shows items whose NAME matches a master entry but whose salt differs — a "correct vs. keep" decision for each |
| **Master updates** (`RefreshCw`) | `planMasterUpdates()` → per-item apply. Pushes the master's current schedule/GST/HSN onto linked items; HSN obeys the **no-downgrade guard** — a more-specific item HSN (8-digit) is never reverted to the master's coarser 4-digit heading |
| **Duplicate finder** (`Copy`) | `findDuplicateGroups()` — surfaces items with the same `brandKey()` across an org so the pharmacist can merge |
| **Add item** | Opens `CreateItemDialog` (from the GRN components) — used when a new item arrives without a prior GRN |

### `/catalog/:id` — Item detail (SALT-080)

`ItemDetailPage.tsx` — inline-edit view for a single item.

- All master fields editable: name, salt, manufacturer, pack, HSN, GST %, schedule, barcode, AYUSH flag.
- **Auto-suggest salt** on open for items with `isBlankish(salt)` — calls the Gemini Edge Function via the `ai_enrich` endpoint (see [import-pipeline.md](import-pipeline.md)).
- **Purchase price history** — PTR/MRP bands from the last 20 GRN lines, rendered as a mini price-history table.
- **Crowd-sourced price stats** (`master_price_stats` view, SALT-182) — when an item links to a `master_items` row with ≥3 contributing shops, shows cross-shop median PTR/MRP as an anonymous market reference. Privacy-safe: only aggregates, never raw rows.
- **Item aliases** — synonyms/barcodes/brand-names attached via `item_aliases`.
- **Promote to master** — calls `promote_to_master(item_id)` RPC; if norm matches an existing row links directly; otherwise enters the Salt-admin review queue.

---

## Data model

### `items` (org-scoped, `0004_items.sql`)

Core per-org item row. Every org has its own copy; no sharing.

| Column | Notes |
|---|---|
| `org_id` | FK → `orgs`, ON DELETE CASCADE |
| `name`, `salt`, `manufacturer`, `pack` | Marg-import or pharmacist-entered |
| `hsn`, `gst_rate`, `schedule` | Compliance fields; `gst_rate` is a point-in-time snapshot |
| `gst_rate_class` | *(not stored on items)* — joined from `master_items` at query time via `master_items(gst_rate_class)` for date-effective GST resolution |
| `master_item_id` | FK → `master_items`, nullable; set by "Fill from master" or `promote_to_master` |
| `barcode`, `ayush_flag`, `reorder_level`, `therapeutic_category` | Extended fields added via `0015_catalogue.sql` |
| `cold_chain`, `units_per_pack` | Added in later migrations |

`ITEM_COLS` in `store/catalog.ts` embeds `master_items(gst_rate_class)` via PostgREST auto-join for date-effective billing without a separate lookup.

### `master_items` (global, no `org_id`, `0015_catalogue.sql` + `0047_seed_master_items.sql`)

The **shared national drug reference** — one row per molecule/FDC (deduped by `norm`, a regex-stripped lowercase name key). All authenticated users may read; writes are privileged (SQL editor / admin RPCs).

| Column | Notes |
|---|---|
| `name`, `salt` | Molecule-level identity |
| `hsn` | **8-digit tariff item** as of `0047` — classified by `classify_hsn()` in `build_seed.py` (see Seeds below) |
| `gst_rate`, `gst_rate_class` | Point-in-time rate + class bucket (`std`/`ayush`/`nil`/`gst18`) |
| `schedule` | `OTC`/`H`/`H1`/`X` — derived from keyword lists in `inputs/schedule_h1.csv` / `schedule_x.csv` |
| `norm` | `UNIQUE INDEX` — the dedup key; blocks silent duplicates on reseed |
| `version`, `updated_at`, `updated_by` | Added by `0053`; incremented by the `trg_master_item_bump` trigger on any UPDATE |
| `source` | `'seed'` (generated) / `'web-enrich'` (admin fixes) / `'shop-submitted'` (crowd) |

### `brand_aliases` (global, `0051_brand_aliases.sql` + `0052_seed_brand_aliases.sql`)

The **brand → molecule crosswalk** — resolves a shop's brand SKU (e.g. `LONAZEP 0.5`) to its molecule (`Clonazepam`), then chains to `master_items` for HSN/GST. Complements `master_items` which is purely molecule-level.

| Column | Notes |
|---|---|
| `brand_key` | `norm_key(brand)` — join key used by `brandKey.ts` and `build_brand_reference.py` |
| `brand` | Cleaned brand name (strength kept, dosage form/pack stripped) |
| `manufacturer` | Disambiguates shared brand stems across makers |
| `composition` | Active molecule(s) + strength |
| `category` | Therapeutic class |
| `confidence` | `high-verified` / `high` / `med` / `low` |
| `master_item_id` | FK to `master_items`; populated later by the molecule link step |

**Unique index:** `(brand_key, manufacturer, composition)` — makes the seed idempotent (`ON CONFLICT DO UPDATE`).

### `master_item_revisions` (`0053`)

Append-only audit: one row per (master_item, version) snapshot. Written by `trg_master_item_revision` (SECURITY DEFINER) on every UPDATE to `master_items`. Authenticated read-only via RLS.

### `master_item_submissions` (`0054`)

Review queue for crowd-sourced master additions. A shop pharmacist calls `promote_to_master(item_id)`; if no norm match exists, a `pending` submission is created. A `salt_admin` approves/rejects via `review_master_submission()`.

### `master_price_stats` (`0056`)

Materialised-style view (or regular view — see schema) aggregating cross-shop PTR/MRP medians per `master_item_id`. Only surfaces when ≥3 distinct `org_id`s contribute — below that threshold no row exists, preserving anonymity. Read by `ItemDetailPage`.

---

## Enrichment pipeline

### 1. Brand key normalisation (`lib/brandKey.ts`)

Single source of truth for brand → lookup key. Strips dosage form (`TAB`, `CREAM`, `INJ`, …), pack quantity (`30'S`, `100ML`), and unit words, but **keeps** numeric strength (`LONAZEP 0.5` → `lonazep05`). The build script `build_brand_reference.py` calls the same logic in Python so the keys stay byte-identical across the DB and the UI.

### 2. "Fill from master" (`lib/masterEnrich.ts`)

Three functions, each a plan/apply pair previewed in the UI before any write:

| Function | Trigger | Behaviour |
|---|---|---|
| `planEnrichment()` | **Fill from master** button | Fill-ONLY — writes only blank/placeholder fields (`isBlankish`). Tries `master_items` first (by salt-key then name-key); falls back to `brand_aliases` for branded SKUs the molecule table doesn't cover |
| `planSaltReplacements()` | **Review salt** button | Overwrite-with-review — where a name match exists but salts differ; caller presents per-item accept/skip |
| `planMasterUpdates()` | **Master updates** button | Compliance push — syncs schedule/GST/HSN from master onto linked items. HSN respects the **no-downgrade guard**: `if (!ihsn.startsWith(mhsn))` — a more-specific item HSN never reverted to a coarser heading |

`isBlankish()` treats Marg placeholders (`OTHERS`, `NA`, `nil`, `-`, etc.) as blank so they become enrichable without a separate cleanup step.

### 3. Brand crosswalk (`matchBrand`)

If `planEnrichment` can't find the molecule in `master_items`, it tries `brand_aliases`. `matchBrand()` disambiguates shared brand stems by manufacturer and bails if the key maps to more than one distinct molecule — no auto-fill on ambiguous stems.

### 4. Gemini AI enrichment

`ItemDetailPage` auto-suggests salt + category for unclassified items by calling the `ai_enrich` Supabase Edge Function (Gemini 1.5 Flash). Non-blocking — the item is saved normally regardless of AI outcome. See [import-pipeline.md](import-pipeline.md) for the Edge Function spec.

---

## Seed pipeline (`supabase/seeds/master-items/`)

| Script | Input | Output |
|---|---|---|
| `build_seed.py` | `inputs/drugs.csv`, `inputs/nlem2022.csv`, `inputs/pmbjp.csv`, `inputs/schedule_h1/x.csv`, `inputs/brand_curated.csv` (new — see Decisions) | `0047_seed_master_items.sql` — **2,832 unique rows**, all with 8-digit HSN |
| `build_brand_reference.py` | `Saral/salt_enrichment.csv` + `Saral/worklist.csv` (untracked) + `brand_curated.csv` | `brand_reference.csv` — **7,497 brand rows**, 7,217 distinct brand keys |
| `build_brand_aliases_seed.py` | `brand_reference.csv` | `0052_seed_brand_aliases.sql` — **7,497 rows**, idempotent upsert |

**HSN classification (`classify_hsn`):** `build_seed.py` maps each molecule to its 8-digit tariff item by drug class (insulin → `30043110`, corticosteroids → `30043200`, antibiotics → `30042099`, antimalarials → `30046000`, vitamins → `30045090`, Ayurvedic → `30049011`, dressings → `30051090`/`30059090`, default residual → `30049099`).

**`brand_curated.csv`:** a tracked hand-curated file for web-verified fixes whose brands never appeared in the Saral worklist (e.g. LOBAK, RING OUT PLUS). Survives any reseed because `build_brand_reference.py` merges it after the Saral-sourced rows with the same dedup/precedence logic.

---

## Key decisions & gotchas

### `master_items` is molecule-level, not brand-level
Brand breadth lives in `brand_aliases`. This keeps the shared master clean (no org-specific brand noise) and lets any brand resolve to its molecule, then chain to the master for HSN/GST. Per [`decisions/0002-stack-divergence-from-prd.md`](../decisions/0002-stack-divergence-from-prd.md).

### HSN is hierarchical — never downgrade
8-digit codes (e.g. `30049099`) are a strict refinement of 4-digit headings (`3004`). The "Master updates" push guards: if `ihsn.startsWith(mhsn)` the item's HSN is already at least as specific — skip. Coarser master codes never overwrite finer item codes. (PR #222)

### `OTHERS` is a placeholder, not a molecule
Marg exports stamp un-classified items with `OTHERS`, `NA`, `-`, etc. `isBlankish()` treats all of these as blank, making them enrichable without a prior cleanup SQL. Real molecule names never collide with these strings.

### Saral/ data is NEVER committed
`Saral/salt_enrichment.csv` and `Saral/worklist.csv` contain real customer trial-balance data. They live in the repo root but are **not in `.gitignore`** — they are manually kept untracked. The build scripts read from them but only commit the de-identified molecule crosswalk (brand_reference.csv / 0052).

### `promote_to_master` is a gated RPC
Normal pharmacists can *nominate* (which creates a `pending` submission); only a `salt_admin` can approve. This prevents pollution of the global master with shop-specific or misspelled items.

### GST rate is date-effective
`gst_rate_class` (on `master_items`) + the `gst_rate_schedule` table (`0046`) + `gstRateForClass()` resolve the correct rate by billing date — critical because the 56th GST Council moved most medicines from 12% → 5% on ~22 Sep 2025. The item-level `gst_rate` is a snapshot for display; billing always re-resolves via the class + date.

---

## Current state vs planned

| Feature | Status |
|---|---|
| Item CRUD + inline edit | ✅ Shipped (SALT-079, SALT-080) |
| Fill from master (molecule + brand crosswalk) | ✅ Shipped (SALT-084) |
| Review salt / Master updates | ✅ Shipped (SALT-084) |
| HSN 8-digit classification | ✅ Shipped (PR #223) |
| HSN no-downgrade guard | ✅ Shipped (PR #222) |
| `brand_aliases` crosswalk + Saral enrichment | ✅ Shipped (PRs #224–#227, 7,497 brands) |
| Master item versioning + audit trail | ✅ Schema shipped (0053); UI not yet built |
| Promote-to-master RPC + review queue | ✅ Schema + RPC shipped (0054); admin UI not yet built |
| Crowd-sourced price stats | ✅ Shipped (0056, SALT-182) |
| Gemini AI enrichment (Edge Function) | ⏳ Edge Function specced; auto-suggest UI wired, deploy pending |
| Salt-admin moderation dashboard | ❌ Not started |
| Fractional stock units (`0057`) | ✅ Migration shipped; UI integration pending |
| Bulk CSV / smart import into catalogue | ✅ See [import-pipeline.md](import-pipeline.md) |

---

## Related pages
- [Data model](data-model.md) — full schema overview
- [Import pipeline](import-pipeline.md) — Marg importer + Gemini OCR
- [GRN](grn.md) — how new items enter the catalogue via purchase receipts
- [Security RLS](security-rls.md) — why `master_items` / `brand_aliases` use read-only authenticated policy + privileged write via SQL editor / SECURITY DEFINER
