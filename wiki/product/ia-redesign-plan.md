---
type: product
updated: 2026-06-03
status: working-draft
tags: [ia, redesign, v2, planning, estimate]
---

> 🚧 **WORKING DOC — V2 definition in progress.** This is a **living artifact**, evolving from ongoing **V1 testing & feedback** (the V1 findings in §13, the Varanasi real-shop test in §11, the §14/§15 integration scoping). It is **not a finalized spec** — scope, estimates and decisions will keep changing as more V1 feedback lands. Treat the numbers as rough and directional.

# Salt IA Redesign — Coverage Audit & Build Plan

> **Purpose.** Two jobs in one doc:
> 1. **Coverage audit** — prove the proposed unified IA drops **no existing capability** (every current module/screen has a home).
> 2. **Plan & estimate** — break the redesign into workstreams with rough sizing, dependencies, and a phased rollout.
>
> **Status:** **working draft for V2 definition** — evolving from V1 testing & feedback. Estimates are **rough, relative, and velocity-dependent** (solo founder + contractors) — calibrate before committing.
> **Sources:** existing surface from `apps/web/src/components/nav/navConfig.ts` + `App.tsx` + `lib/permissions.ts`; proposed model from the interactive IA artifacts in [`wiki/design/`](../design/index.md).

---

## 1. TL;DR

- **Nothing is dropped.** All 13 modules / ~70 screens map to a home in the proposed IA. The **owner lens = the union of all capabilities**, so every existing screen remains reachable by someone — most are **re-homed / re-skinned, not rebuilt**.
- **The cost is concentrated, not spread.** ~80% of existing screens are **reused** (moved to a new area, same logic). The real build is a small set of **net-new** pieces: the capability→lens foundation, the assembled Home, the Money/Books accounting depth, the unified product lookup, the **offline substrate**, and the **field mobile app**.
- **Two big-ticket items dominate the estimate:** the **offline substrate** and the **field mobile app** (~30–40 person-days together). A **desktop-only** redesign (everything except those two) is far cheaper and delivers most of the value.
- **It can ship incrementally behind a flag** — the capability layer wraps the existing screens, so there's low regression risk if the foundation is solid. Recommended order delivers owner/manager value first and defers the expensive offline+field work to the end.
- **Validated against a real shop** (Varanasi wholesale — see §11). The lens model absorbed the org's shape with no restructure; the test added **2 capability atoms** (13 → 15) and **1 off-axis item** (external/scoped access), now folded into this plan.
- **Primitive quality is a real chunk** (§13). V1 findings — tables that overflow/misalign, money formatting, text truncation, the counter's line-entry grid, hierarchical discounts — are foundational, not polish. They move the core estimate up and must land early (every later screen inherits them).

**Rough total:** ~**112–181 person-days** (~5.5–9 person-months) full scope · ~**79–136 days** (~4–7 months) desktop-only. *(Includes the §13 quality foundation; excludes the optional multi-platform packaging, §12.)*

---

## 2. The two IAs, in one line each

| | Shape | Organising principle |
|---|---|---|
| **Existing** | 13 top-level modules, ~70 screens, a static role-gated sidebar (`navConfig.ts`) | Organised by **data module** (Counter, Purchases, Sales, Inventory, Parties, Payments, GST, Reports, Catalogue, Salesmen, Activity, Approvals, Settings) |
| **Proposed** | One substrate + a **derived lens** per user; ~6 surfaces + persistent actions | Organised by **capability atoms × altitude × context**; a "persona" is a preset lens |

Proposed surfaces: **Home** (assembled) · **Counter** (sell/dispense/bill lenses) · **Buy** · **Stock** · **Money** (+ Books depth) · **Comply** · **Field** (mobile) · **Setup** — plus persistent **Inbox / Export / Find / Sync** derived from capabilities.

---

## 3. Coverage audit — existing → proposed (nothing dropped)

**Status legend:** ♻︎ Reuse (re-skin in place) · ⤴ Re-home (move area, same logic) · ⊕ Merge (combine surfaces) · ✦ Net-new build · ⚠ Decision needed

| # | Existing module | Screens | → Proposed home (surface · capability) | Status | Notes |
|---|---|---|---|---|---|
| 1 | **Counter** | Active bill, Hold/park, H1/X gate, Tender split | **Counter** · atoms B (bill), and inline H1 gate | ♻︎ + ✦(arrangement) | Logic reused; the *3-lens* composition (sell/dispense/bill on one surface) is a new arrangement, not new screens. |
| 2 | **Activity** | Live feed | **Home** (assembled feed) + realtime | ⤴ | Feed becomes a Home signal source; still its own view for those who want it. |
| 3 | **Approvals** | Manager inbox | **Inbox** (persistent) + **any-holder routing** | ♻︎ + ✦(routing) | Screen reused; routing to "any approver present" is new. |
| 4 | **Purchases** | GRN history/new/detail, OCR scan + history, POs (list/new/detail), reorder suggest, vendor schemes, debit notes (list/new/detail) — **13** | **Buy** · atoms D (order), E (receive) | ⤴ ♻︎ | Straight re-home of a fully built module. |
| 5 | **Sales** | Invoices, Invoice detail, Credit notes, H1/X register | **Counter** (invoices/credit-notes = its output) + **Comply** (H1 register) | ⤴ | H1 register re-homed to Comply (+ inline at Counter); fixes today's nav drift. |
| 6 | **Inventory** | Stock ledger, Near-expiry, Dead/slow, Reorder, OOS, Turnover, Adjustments, Physical count, Expiry destruction, Transfers — **10** | **Stock** · atom F | ⤴ ♻︎ | Straight re-home. |
| 7 | **Parties** | All, Customers, Vendors, Profile, Vendor purchase entry (legacy) | **Money** · atoms H, I | ⤴ + ⚠ | Re-home; legacy `/parties/:id/purchase` flagged for drop (see §6). |
| 8 | **Payments** | Receive, Make, Bank rec (planned) | **Money** · atom H | ⤴ + ⚠ | Bank rec is a planned feature, not IA work. |
| 9 | **GST & compliance** | GSTR-1, GSTR-3B, Liability, ITC, Tally export, HSN, H1/X register, Invoice series, GSTR-2B recon (planned), Drug licenses | **Comply** · atom K (+ H1 gate at Counter) | ♻︎ + ⚠ | Re-skin; GSTR-2B recon UI is a planned feature. |
| 10 | **Reports** | Dashboard, Sales, Purchases, Inventory, Financial, Tax | **DISSOLVED**: Dashboard→Home; Sales→Counter; Purchases→Buy; Inventory→Stock; Financial→Money/Books; Tax→Comply | ⤴ | **Highest re-home risk** — see §4. Each suite is explicitly re-homed; the dashboard becomes the assembled Home. |
| 11 | **Catalogue** | Items, Item detail | **Stock** + **Find** (persistent salt/product search) | ⊕ + ✦ | Items reused; the **unified product lookup** (stock+location+price+scheme+substitute+upsell in one result) is net-new. |
| 12 | **Salesmen** | All salesmen, Salesman detail | **Money** (attribution) + **Field** (mobile front end) | ♻︎ + ✦ | Owner-facing screens reused; the field-facing mobile app is net-new. |
| 13 | **Settings** | Users, Roles, Import hub, Smart Import, Purchase import, GL import, Org, Shops, Drug licenses, Print, Data export, Audit, Privacy, Discount limits, WhatsApp, Setup wizard — **16** | **Setup** (split: Admin / Data&Import / Integrations) + **Comply** (licenses) | ⤴ split | Everything kept; the 16-item catch-all is split and licenses move to Comply. |

**Coverage guarantee.** Because the owner lens holds every atom, every row above remains reachable. Recommend a **CI invariant** (extend the existing `apps/web/scripts/check-nav.mjs`) asserting *every current route resolves to ≥1 capability atom + surface* — a mechanical "nothing dropped" gate during the migration.

---

## 4. Explicitly retained — the "looks dropped but isn't" list

These are the items most likely to *seem* dropped in a lens-based redesign. Each is retained, just re-homed:

- **The Reports silo** → dissolved **into context**, not deleted. Dashboard → Home; each suite lives in its area (Sales→Counter, Purchase→Buy, Inventory→Stock, Financial→Money/Books, Tax→Comply). *Same `v_*` views, same `lib/reports.ts`.*
- **Drug licenses** → moved Settings → **Comply** (with renewal alerts surfaced on Home). Reachable, just in the right place.
- **H1/X register** → **Comply** (the register/export) **+** inline gate at **Counter** (the entry). Today it's only under GST; now it has a canonical home + the inline capture.
- **Per-user grant/revoke** (`lib/permissions.ts`) → becomes the **capability-atom assignment** UI; the existing model is the seed, not thrown away.
- **Everything under Settings** → split across Setup/Comply, nothing removed.

---

## 5. Net-new capabilities the proposed IA adds

(These are the build, not the re-homes.)

| Net-new piece | What it is | Why |
|---|---|---|
| **Capability→lens foundation** | Refine module-level perms (`lib/permissions.ts`) into ~13 atoms + altitude + context; a `deriveLens()` that computes lit surfaces, primary surface, persistent action | The spine of the whole redesign; turns 7 hard-coded IAs into 1 derived one |
| **Assembled Home** | Per-atom signal-tile registry; Home composes from held atoms (pulse/floor/desk/working-screen emerge) | Replaces 7 hand-built Homes with one rule |
| **Unified product lookup** | One result = stock + **rack location** + price + scheme + substitute + upsell | The shop-salesman signature; fixes "told a customer 'hai' on stale memory" |
| **Money → Books depth** | Dr/Cr ledgers, vouchers, trial-balance, reconcile views over existing data | The accountant's mental model; today only `v_trial_balance`/`v_pnl` exist as reports |
| **Export-anywhere** | Tally/CSV/Excel/JSON from any view (generalise today's `exportData.ts` + Tally export) | The accountant's persistent action |
| **Any-holder routing** | Gates/escalations route to "any holder of capability X", not a named role | Handles shared/absent duties |
| **Offline substrate** | IndexedDB read-cache + RPC write-outbox + sync (today: Phase-1 *design only*) | Offline counter + the field app depend on it; the strategic wedge |
| **Field mobile app** | Offline-first PWA: beat / order / collect / my-number, sync to shop | The one persona that forks from the desktop base |
| **Pick / fulfil (godown)** ✦ | A godown surface: pick list → assemble → stage → dispatch; bridges "order booked" → "goods out" | Surfaced by the Varanasi test (§11); wholesale picking was under-modeled |
| **Wholesale supply-compliance** ✦ | Buyer-licence validation + schedule supply register (sell-only-to-licensed) | Atom C is retail-shaped; wholesale needs this sibling (§11) |

*These two take the capability set from **13 → 15 atoms**. Because they register into the same substrate (auto-home into the relevant lenses), they're **additive, not a restructure** — which is the model's whole promise.*

---

## 6. At-risk items & decisions needed (⚠)

| Item | Decision | Impact if deferred |
|---|---|---|
| **Legacy `orders`/`order_lines` + `place_order`** (superseded by `sales_invoices`/`create_sales_invoice`) | Migrate any remaining callers, then drop | Two sales models persist; confuses the Counter capability mapping |
| **`/parties/:id/purchase`** (legacy GRN-lite) | Drop in favour of `/purchases/new` (Buy) | Dead path; minor |
| **GSTR-2B reconciliation UI** | Build as a feature (tables exist) — separate from IA work | Comply has a known gap; not an IA blocker |
| **Bank reconciliation** | Build as a feature (table exists) — separate from IA work | Money has a known gap; not an IA blocker |
| **Rack/bin location** | Promote from `source` jsonb to a typed column | The unified lookup's "where on the rack" needs real data |
| **Stale wiki** (`data-model.md`, `schema.md`) | Reconcile to the live schema | Docs mislead anyone planning off them |
| **External / scoped access** (the CA; multi-shop) | Extend the identity model: scoped, expiring, read+export-only membership across orgs | The one **off-axis** gap (tenancy, not IA) — surfaced by the Varanasi test (§11) |

---

## 7. Build plan — workstreams

Sizing: **S** ≈ 1–2d · **M** ≈ 3–5d · **L** ≈ 1–2wk · **XL** ≈ 3wk+ (one dev). Dependencies in the last column.

| WS | Workstream | Size | Rough days | Net-new vs reuse | Depends on |
|---|---|---|---|---|---|
| **WS1** | **Capability & lens foundation** — atoms + altitude + context + `deriveLens()`; extend `permissions.ts`; feature flag | XL | 10–15 | Net-new (seed exists) | — |
| **WS2** | **Unified shell & nav** — capability-derived rail/topbar replacing static navConfig consumption; primary-surface landing; mode-switch | L | 5–10 | Reuse AppLayout + new | WS1 |
| **WS3** | **Assembled Home** — signal-tile registry per atom; compose from held atoms (reuse Reports dashboard + Activity + Approvals data) | L | 5–8 | Net-new (data exists) | WS1, WS2 |
| **WS4** | **Counter 3-lens + unified lookup** — sell/dispense/bill on `BillingScreen`; rack-location + upsell lookup | M–L | 5–8 | Reuse counter + new lookup | WS1; rack data (§6) |
| **WS5** | **Money + Books** — merge Parties+Payments+Salesmen+Financial; add Dr/Cr / vouchers / trial-balance / reconcile | L | 7–12 | Reuse + new accounting depth | WS2 |
| **WS6** | **Comply unification** — GST + H1 register + licenses in one; re-home licenses | M | 3–5 | Reuse, re-home | WS2 |
| **WS7** | **Buy + Stock re-home** — Purchases→Buy; Inventory+Catalogue→Stock; wire Find | M | 3–5 | Reuse, re-home | WS2 |
| **WS8** | **Export-anywhere** — generalise export across views (Tally/CSV/Excel/JSON) | M | 3–5 | Reuse + generalise | WS2 |
| **WS9** | **Inbox elevation + any-holder routing** — first-class Inbox; route by capability | M | 3–5 | Reuse + new routing | WS1 |
| **WS10** | **Offline substrate** — IndexedDB read-cache + RPC write-outbox + sync/conflict | XL | 15–20 | Net-new (Phase-1 design only) | WS1 |
| **WS11** | **Field mobile app** — PWA shell; beat/order/collect/my-number; sync to shop | XL | 15–20 | Net-new | WS1, WS10 |
| **WS12** | **Settings split** — break the 16-item catch-all into Admin/Data/Integrations | S–M | 2–4 | Re-home | WS2, WS6 |
| **WS13** | **Legacy cleanup** — drop `orders`/`place_order`/vendor-purchase-entry; reconcile docs | M | 3–5 | Removal | migration done |
| **WS14** | **Design-system pass** — migrate remaining raw-zinc screens; new primitives (lookup card, mobile shell, assembled Home) | M | 3–5 (ongoing) | Reuse tokens | per-screen |
| **WS15** | **Wholesale fit** — `pick/fulfil` atom (godown pick list → dispatch) + wholesale `supply-compliance` atom (buyer licence + supply register) | M–L | 5–8 | Net-new atoms | WS1, WS7 |
| **WS16** | **External & scoped access** — scoped / expiring, read+export, multi-org membership (the external CA) | M | 3–5 | Net-new (tenancy) | WS1 |
| **WS17** | **DataTable primitive (real design)** — aligned sticky header↔rows, deterministic column sizing, in-cell truncation, responsive table↔cards, right-aligned `tabular-nums` (§13) | M–L | 5–8 | Upgrade (pattern exists, flawed) | WS14 |
| **WS18** | **Money format** — extend `currency.ts`: ₹ + 2dp, compact **K/L/Cr** (Indian), full value on hover (§13) | S | 1–2 | Upgrade `currency.ts` | — |
| **WS19** | **Truncate-everywhere** — `Truncate` + Tooltip primitive; never overflow, full text on hover; applied across screens + grid cells (§13) | S–M | 2–3 | New primitive | WS17 |
| **WS20** | **Inline spreadsheet grid (quick-fill)** — omnidirectional keyboard nav, in-cell medicine autocomplete, Tab/Enter/paste; the counter line-entry hot path (§13) | L–XL | 8–15 | New (build vs adopt headless grid) | WS4 |
| **WS21** | **Hierarchical discounts + auto-fill** — extend `price_rules`/`resolve_price`: customer / customer+vendor / customer+item (most-specific wins), persisted, auto-fill last-order rate (§13) | M–L | 5–10 | Extend `price_rules` (0039) | WS1, WS4 |

**Subtotals:** foundation quality (WS17–21, §13) ≈ **+21–38 days**; desktop-only (WS1–9, 12, 14–21) ≈ **79–136 days**; +offline+field (WS10–11) ≈ **+30–40 days**; +cleanup (WS13) ≈ **+3–5 days**. **Full ≈ 112–181 days.** *(Excludes the optional multi-platform packaging, §12.)*

---

## 8. Phased rollout (incremental, behind a flag, value-early)

| Phase | Workstreams | Outcome | Who benefits first |
|---|---|---|---|
| **0 · Foundation** | WS1 + WS2 | Capability atoms + derived shell, shipped dark (flag off) | nobody yet (infra) |
| **1 · Desktop oversight** | WS3, WS6, WS7, WS9, WS5(light), WS14 | Owner & Manager get the new experience (Home, Inbox, re-homed areas) | **Owner, Manager** |
| **2 · The counter** | WS4 | 3-lens counter + unified lookup | **Pharmacist, Cashier, Shop salesman** |
| **3 · The back office** | WS5(Books), WS8 | Money/Books depth + Export-anywhere | **Accountant** |
| **4 · Offline** | WS10 | Offline counter (the wedge) | everyone at the counter |
| **5 · Field** | WS11 | The mobile beat/collect app | **Field salesman** |
| **6 · Cleanup** | WS12, WS13 | Settings split finalised; legacy dropped | maintainers |

Rationale: ship the **cheap, high-coverage re-homes first** (Phases 0–3 ≈ desktop-only), prove the lens model, then take on the **expensive offline + field** build (Phases 4–5) once the foundation is battle-tested. Each phase is independently shippable behind the flag.

---

## 9. Assumptions, risks, and what would sharpen this estimate

**Assumptions**
- One developer baseline; the existing screens/RPCs are reused as-is (no logic rewrites, only re-home + re-skin).
- `lib/permissions.ts` capability model is extended, not replaced (meaningfully reduces WS1).
- The design-system tokens/primitives exist; most screens already migrated (per `design-system.md`).

**Risks (and mitigation)**
- **WS1 underestimate** — the lens derivation touches every screen's mounting. *Mitigate:* build behind a flag; one area as a vertical slice first.
- **WS10 offline** is genuinely hard (sync/conflict on RPC writes). *Mitigate:* it's a prerequisite for WS11 — sequence it alone, time-box a spike.
- **Reports dissolution** could orphan a report. *Mitigate:* the CI coverage invariant (§3) + a per-suite re-home checklist.
- **Shared/absent routing** (any-holder) changes approval semantics. *Mitigate:* keep "owner absorbs by default" as the fallback.

**What would sharpen the estimate**
- Team velocity / number of contractors (turns day-ranges into a calendar).
- A decision on scope: **desktop-only first** vs full (offline+field) — that's the ±40-day swing.
- A vertical-slice spike of WS1+WS2 on **one** area (e.g. Comply) to calibrate the foundation cost.

---

## 10. One-screen summary

- **Coverage:** 13/13 modules re-homed, **0 dropped**; ~80% reused, the rest net-new. CI invariant enforces it.
- **Cost centre:** WS1 (lens foundation), WS5 (Books), WS10 (offline), WS11 (field) — everything else is cheap re-homing.
- **Capabilities:** **15 atoms** (13 + pick/fulfil + wholesale supply-compliance). One off-axis item: external/scoped access (tenancy).
- **Foundation quality (§13):** a real DataTable, money formatting (2dp + K/L/Cr), truncate-everywhere, the counter's inline entry grid, and hierarchical discounts — core, not polish; land early.
- **Path:** flag-gated, owner/manager value in Phase 1, offline+field deferred to Phases 4–5.
- **Validated:** absorbed a real Varanasi wholesale shop with no restructure (§11).
- **Range:** desktop-only ~4–7 person-months; full ~5.5–9 person-months (+ optional multi-platform §12) — *calibrate to your velocity.*

---

## 11. Real-shop validation — Varanasi wholesale pharmacy

Stress-tested against a real org: **2 owners (both man counters), 1 counter employee, 3–4 in-shop salespeople (floor + godown), 4 field salesmen**, and an **external CA** for tax & compliance. The lens model absorbed the org's shape; the test produced concrete changes to this plan.

**Held up — no restructure:** no manager → the manager's atoms redistribute to owners / godown / field (no empty screen); operating owners → *operate* altitude flips their landing from pulse to the **counter**; the employee's over-limit escalation routes to **any owner** (a capability, not a named manager); 2 owners · 4 field · ~3 shop = multi-instance + 3-counter realtime; the field offline/scan substrate is reused by the godown.

**Surfaced — folded into this plan:**

| Finding | Type | Lands in |
|---|---|---|
| **Pick / fulfil** — wholesale godown picking (order booked → assembled → dispatched) was under-modeled | ✦ additive atom | §5 · **WS15** |
| **Wholesale supply-compliance** — buyer-licence validation + schedule supply register; atom C was retail-shaped | ✦ additive atom | §5 · **WS15** |
| **External / scoped access** — the CA is external, multi-shop, read+export; today's `memberships` is internal, one-org-per-user | ⚠ off-axis (tenancy) | §6 · **WS16** |
| **Books-drift** — with only a tax CA, daily books/reconciliation (J/H) is under-held | gap (operational) | the model *flags* it; assign J/H to an owner or part-timer |

**Verdict:** the org-shape divergences were all **config + derivation**; the two domain gaps are **additive atoms** (set grows 13 → 15); the one off-axis item (external access) is the conscious-bet boundary named in the strategy — the test *found* it, which is the model working as intended. **No V3.**

---

## 12. Multi-platform packaging — Windows · Mac · Android (optional, on top of §7)

> **Separate, optional scope** — *not* included in the §1/§10 totals. Estimates assume the IA plan's **WS10 (offline substrate)** and **WS11 (field app)** are already being built, so the overlap is not double-counted.

### 12.1 The reframe — wrap, don't rewrite

The app is a clean React-on-Supabase SPA, so you **wrap the one codebase**; the backend (Supabase over HTTPS — REST, Realtime, Auth) is **unchanged**.

| Strategy | What it is | Verdict |
|---|---|---|
| Full native (.NET / Swift / Kotlin ×3) | Three codebases | ❌ Enormous, no reuse |
| React Native | New mobile UI layer | ❌ Discards the React-web screens; RN-desktop immature |
| **PWA** | Existing app, installable + offline | ✅ Cheap baseline; weak native printing/stores |
| **Tauri (desktop) + Capacitor (Android)** | Thin native shells around the same build | ✅ **Recommended** — installers, native printing/scan/push, store distribution |

**Gating dependency:** a wrapped *online-only* app is just a browser in a window. The native value depends on **WS10 (offline)**; and **WS11 (field app) ≈ the Capacitor Android build** — build it as Capacitor from the start and P2 is nearly free.

### 12.2 Platform ROI

| Platform | Verdict | Why |
|---|---|---|
| **Windows** | ✅ High | Tier-2/3 counter PCs are Windows; native **dot-matrix/thermal printing** (a D&C requirement), offline stability, "real app" feel |
| **Android (Play Store)** | ✅ High | The **field salesman** (already WS11) + push reminders + legitimacy; Android-first (cheap phones), not iOS |
| **Mac** | ⚠ Low | These shops are ~never on Mac. Tauri gives it free as a build target, but Apple Dev + notarization + Mac-App-Store review + testing isn't worth ~0 users → **ship Mac as the PWA, skip the store** |
| iOS | — | Not requested; Capacitor can cover later, but adds Apple review + device cost |

### 12.3 Workstreams (incremental, one dev, rough)

| # | Workstream | Size | Days | Notes |
|---|---|---|---|---|
| **P0** | **PWA baseline** — manifest, service worker, app-shell cache, install prompts, icons, update flow | S–M | 3–6 | Offline *data* = WS10 |
| **P1** | **Tauri desktop shell** (Windows primary; Mac as build target) — window/menus, auto-update, `.msi`/`.dmg`, **code-signing**, CI | M–L | 8–15 | Win Authenticode + Apple Dev certs |
| **P2** | **Capacitor Android** — wrap, native plugins, Play listing + review, Play App Signing | M | 5–10 | **Overlaps WS11** → ~0 extra if WS11 is built as Capacitor |
| **P3** | **Native integrations** — **printing** (thermal/A4/dot-matrix) 8–15d · scanners (USB/camera/BT) 3–6d · push (FCM) 2–4d · auto-update / secure-token / deep-link OAuth 3–6d | L–XL | 16–30 | **The real cost centre — printing especially** |
| **P4** | **Store & release ops** — dev accounts, signing, per-platform CI, review cycles, staged rollout | M | 4–8 | + ongoing |
| **P5** | **Cross-platform / device QA** — low-end Windows PCs, Android phones | M | 5–10 | + ongoing |

**Incremental total: ~40–75 person-days (~2–3.5 person-months)** on top of §7 — concentrated in **printing** and the **signing/store/QA tax**, *not* in porting UI (the React is reused as-is).

### 12.4 The cheaper floor

**PWA + TWA only** (no Tauri/Capacitor): installable on Win/Mac/Android + Play Store via a Trusted Web Activity wrapper — **~6–12 days**. But it under-serves the **counter** (weak native printing, no Microsoft/Mac-store feel, iOS PWA limits). Good for the **field app + glance-y owner use**; insufficient as the primary counter POS.

### 12.5 Recommended sequence & ongoing tax

- **Sequence:** PWA floor (P0) → **Windows/Tauri** when native printing + offline counter matter → **Android/Capacitor** falls out of WS11. Defer/skip Mac store.
- **Ongoing tax:** dev accounts (Apple $99/yr · Play $25 once · MS $19 once), cert renewals, **app-review on every release** (Apple strictest), webview/OS-compat upkeep — budget ~10–15% release overhead once in stores.

**Bottom line:** going multi-platform is **~2–3.5 incremental person-months**, dominated by native **printing** and **store/signing ops** — not UI porting. Keep **Windows + Android**, cover Mac with the PWA.

---

## 13. V1 quality findings → V2 foundation requirements

Five things observed running V1. Four are **foundational primitives** (they touch every screen or the billing hot path); one is a **billing feature**. These are **core to V2, not optional polish** — the IA can be perfect, but if a table overflows and money is unreadable, the owner's 60-second judgment fails (design.md §3 *trust through precision*; the ESL persona insight that staff **scan numbers, not prose**). Most are **upgrades/extensions of existing code**, not greenfield.

| # | V1 finding | V2 requirement | Serves | New / upgrade | WS |
|---|---|---|---|---|---|
| 1 | Tables overflow; headers & rows misalign | A real **DataTable primitive** — aligned sticky header↔rows, deterministic column sizing, in-cell truncation, responsive table↔cards, right-aligned `tabular-nums` | Every list screen (Bills, Parties, Stock, GST, Reports); *trust through precision* | Upgrade (DataTable *pattern* exists but is flawed) | **WS17** |
| 2 | Money needs 2-dp **and** Indian abbreviation | Extend `currency.ts`: full `₹1,23,456.78` where space allows; compact **K / L / Cr** in dense tables/tiles, full value on hover | Owner reads totals at a glance; ESL "scan numbers"; en-IN standard | Upgrade `currency.ts` | **WS18** |
| 3 | Text overflows containers | **Never overflow** — a `Truncate` + Tooltip primitive (ellipsis; full text on hover), applied globally and inside grid cells | Density; ESL; trust | New primitive | **WS19** |
| 4 | Quick-fill (Counter) is clumsy | An **inline spreadsheet grid** for line entry: omnidirectional arrow-key nav, Tab/Enter semantics, **in-cell medicine autocomplete** (dropdown opens *on the focused cell*), paste/fill | The counter hot path — the **cashier's keystroke rhythm**, the **accountant/Marg/Excel** muscle memory, the shop-salesman's find-on-the-cell | New (build vs adopt a headless grid) | **WS20** |
| 5 | Discounts aren't remembered or hierarchical | **Hierarchical discounts** — customer / customer+vendor / customer+item (most-specific wins), **persisted**, and **auto-filled from the last order's actual rate** | Shop-salesman quoting; owner relationship pricing; removes the "guess or ask the manager" failure | Extend `price_rules` (0039) + `resolve_price` | **WS21** |

**Decision to lock for WS21 (precedence):** an explicit **saved rule** wins → else the **last-order rate** for that customer (×vendor/×item) → else the catalogue default. Surface *which* rule fired so the salesman trusts the number (and the owner can audit it).

**Sequencing:** WS17–19 are **foundational** — pull into **Phase 0/1**; every later screen inherits them. WS20 (the grid) and WS21 (discounts) belong in **Phase 2** (the counter). WS18/WS21 build on existing `currency.ts` / `price_rules`, so they're lower-risk than they look.

**The meta-finding:** V2's cost isn't only IA re-homing — a real chunk is **primitive quality** (tables, money, truncation, the entry grid). This is the gap between "the structure is right" and "it *feels* right in the first 60 seconds." It moves the core estimate to **~112–181 days** (§7) and is the strongest argument for **doing the foundation before the re-homes**, not after.

---

## 14. Inbound invoice interchange — auto-capture supplier invoices (new capability, beyond §7)

> **Separate, optional scope** — *not* in the §1/§10 totals. Rides on existing foundations (GSTIN identity ADR-0010, the OCR pipeline `purchase_ocr_jobs` / `importPurchaseInvoice`, the `b2b_connections` stub) and attacks the **#1 daily pain — manual GRN of dozens of supplier invoices** (the Pharmarack / Retailio idea).

### 14.1 The reframe — build the *inbox*, not the network

"Invoices flow manufacturer → distributor → wholesaler → retailer, all in-app" only fully works if **every tier adopts Salt** (chicken-and-egg). Instead, build **one capability — inbound invoice → draft GRN — fed by whatever rail is available**, unified in one review inbox. Three enablers already exist: **GSTIN** as canonical party identity; the **OCR/parse pipeline** as the landing zone; **`b2b_connections`** for consented links.

**Hard rule: always land as a draft for one-tap review — never auto-post stock / payable / ITC.** Preserves the lifecycle-S5 verification control (the manager's "challan vs boxes").

*(Note: AIOCD **AWACS** is a market-data aggregator, not an invoice-inflow channel; **Pharmarack / Retailio** are the order+invoice interchange analog.)*

### 14.2 The four rails (complementary by coverage)

| Rail | Covers | Feasibility | Dependency | Effort |
|---|---|---|---|---|
| **1 · Salt → Salt** (GSTIN-matched, consented) | Any tier already on Salt | ✅ **Build now** — a seller's `create_sales_invoice` materialises a **draft GRN** in the buyer's org | consented link + RLS-safe cross-org write (= the external/scoped-access tenancy item, §6 / WS16) | **M** |
| **2 · Email / Gmail ingest** | **Everyone** (PDF by email) | ✅ **Build now, no partner** — Gmail OAuth + inbox watcher + attachment → **existing OCR** → draft GRN | parse accuracy (keep human-in-the-loop) | **M–L** |
| **3 · GST e-invoice / GSTR-2B via a GSP** | Upper chain (sellers > ₹5 Cr) | 🟡 Standards-based, **no bilateral deal** | a GSP integration; misses sub-₹5 Cr distributors | **L–XL** (fold into the planned GSTR-2B recon) |
| **4 · Pharmarack / Retailio / AIOCD** | Legacy Marg-based trade | 🟠 **Partnership-gated**, not self-serve | a BD deal (ADR-0016 stance) | mostly **BD** |

Coverage is complementary: e-invoice covers the top of the chain, the Salt-network the adopters, email the long tail, a partner the legacy trade — the inbox unifies them.

### 14.3 Fit, sequencing & caveat

- **Capability atom:** *inbound invoice capture* → feeds **Buy / Receive (atom E)**. Additive — **no V3**. The cross-org data flow is the *same* external/scoped-access tenancy concern (§6 / WS16), not a new axis.
- **Recommended:** ship **Rail 2 + Rail 1** first (unilateral, reuse OCR + GSTIN + `b2b_connections`; immediate value + the network moat) → **fold Rail 3 into the GSTR-2B reconciliation** → treat **Rail 4 as a BD track**.
- **Caveat:** Rail 2 parse accuracy is the variable — keep the **human-in-the-loop draft-review** step regardless (you want it for the S5 control anyway).
- **Rough effort** (beyond §7, one dev): Rail 2 ≈ M–L · Rail 1 ≈ M · Rail 3 ≈ L–XL + a GSP deal · Rail 4 ≈ mostly BD.

---

## 15. Marg connector — migration bridge + invoice rail (new capability, beyond §7)

> **Separate, optional scope** — *not* in the §1/§10 totals. Good news up front: **you already integrate with Marg** — the `migrator/` Go tool reads Marg DBF and uploads via an RPC. This is an **extension of code you own**, not a greenfield API project.

### 15.1 Verdict & the reframe

**Don't architect around a public Marg API.** Marg 9+ is a closed, single-machine **Windows desktop app on proprietary DBF files**. It markets *some* integration (e-invoice, e-commerce, the MargBooks cloud), but a documented, self-serve REST API over the **desktop transactional data** is limited, edition-dependent and usually **partner/licence-gated** — verify per install, but plan for "no reliable API."

**The reliable path: a local connector agent that reads Marg's data files and syncs to Salt over HTTPS** — extending the existing migrator from one-time → incremental.

**On "TCP/IP messaging" — wrong layer.** Marg exposes no socket/message bus; raw TCP/IP would only be the transport for *your own agent* on the Marg PC, and **HTTPS beats it on every axis** (TLS, firewall/NAT-friendly, auth, simplicity, already used for Supabase). The real question isn't "API vs TCP/IP" — it's *"what reads Marg's data (a local agent) and how does it reach Salt (HTTPS)."*

### 15.2 Integration surfaces (ranked)

| Path | What | Feasibility | Notes |
|---|---|---|---|
| **1 · Local connector agent (DBF read)** | Windows agent reads DBF, computes deltas, syncs over HTTPS | ✅ **Proven** — extends the Go migrator | Read-oriented; DBF schema undocumented & version-varying (migrator already maps it) |
| **2 · ODBC / SQL-edition read** | Read via ODBC where the install runs Marg's SQL edition | ✅ Cleaner *if available* | Edition-dependent; verify per customer |
| **3 · Marg partner API** | If/where Marg exposes one | 🟠 **BD-gated**, coverage uncertain | Don't depend on it |
| **4 · Raw TCP/IP to Marg** | — | ❌ **Not a thing** | No socket bus; only a worse transport for your own agent |

### 15.3 Direction — read-mostly

- **Read *from* Marg** (masters, stock, parties; sales/purchase/payment transactions) → ✅ feasible, high-value.
- **Write *into* Marg** → ⚠️ **avoid** — DBF writes can corrupt Marg's indexes; if ever required, only via Marg's own sanctioned import.

### 15.4 Two high-value uses

1. **Zero-touch migration + parallel-run bridge.** The persona's #1 reason *not* to switch is "I won't re-enter 5,000 items and 300 balances." A resident agent mirroring Marg → Salt lets them **run both side-by-side during the switch** — directly serving the "migration handled for me" adoption criterion.
2. **A DIY invoice-capture rail** (the §14 Rail 4 alternative): run the same agent at a *Marg-based supplier's* site → pull outward invoices → drop them into the buyer's Salt inbox. Captures the huge Marg installed base **without** a Pharmarack deal — at the cost of per-site install + the owner's consent (same scoped-access/tenancy theme, §6 / WS16).

### 15.5 Risks & effort

- **Risks:** DBF **schema drift** by version/edition (agent needs version mapping + a maintenance tax as Marg updates); **per-site deployment + consent**; per-deployment checks (DBF vs SQL/ODBC; any partner-API availability).
- **Effort** (beyond §7, one dev): incremental DBF agent + delta detection + sync status ≈ **M–L** (leverages the migrator) · supplier-side invoice push (cross-org consent) ≈ **+M** (overlaps §14 Rails 1–2) · ODBC variant ≈ **S–M** · write-back ≈ **avoid**.

**Net:** treat Marg integration as **a local, read-only connector agent over HTTPS, extending your migrator** — not an API project, not raw TCP/IP. It doubles as the **migration accelerant** and a **DIY invoice rail** from the Marg base.
