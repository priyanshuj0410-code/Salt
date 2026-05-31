---
type: architecture
updated: 2026-05-31
tags: [ondc, beckn, vendor-ordering, procurement, integration]
---

# ONDC for B2B pharma ordering

How the **Open Network for Digital Commerce (ONDC)** works, whether it can carry **vendor ordering** for Salt — a pharmacy reordering stock from its distributors, electronically, from inside the app — and what building on it would take. This is the technical detail behind ADR [0016 — vendor ordering is distributor-mediated](../decisions/0016-vendor-ordering-channel.md), which records the decision.

**TL;DR.** ONDC is the only *open, standardised* rail on which a pharmacy could place purchase orders to distributors from inside Salt — every other option (Pharmarack, Retailio, Saveo) is a closed, partnership-only app, and the manufacturers in `known_vendors` sell only through distributors, never via a retailer-facing API (see [domain/parties](../domain/parties.md) and ADR 0016). **But B2B pharma on ONDC does not meaningfully exist yet:** the network deliberately limits pharmacy to **OTC, B2C only** — no prescription medicines, and no retailer↔distributor B2B-pharma category. So ONDC is a **watch-and-prototype** bet, not a near-term integration. Neither ONDC play is on the v1 critical path.

## What ONDC is

ONDC is **not a platform** — it is an open **network of protocols** that lets independent buyer apps and seller apps transact with each other, the way UPI lets any bank's app pay any other. It layers the **Beckn** application-layer protocol (the base spec) with an **ONDC network-extension layer** (India-specific catalog/fulfilment models). A seller listed on one seller app becomes discoverable to *every* buyer app on the network — no per-marketplace onboarding, no platform lock-in, no marketplace commission.

For Salt the relevant question is narrow: can a pharmacy, as a **buyer**, discover a distributor's live catalog and place a purchase order over this network? Mechanically yes; for regulated medicines, not yet (see *Pharma — the regulatory gate*).

## The four participant roles

| Role | Beckn term | Who it is | Relevance to Salt |
|---|---|---|---|
| **Buyer Network Participant (BNP)** | BAP (Beckn App) | The demand-side app — search/discovery, checkout, customer support | **This is Salt's role for procurement.** Salt would be a buyer app so its pharmacies order stock |
| **Seller Network Participant (SNP)** | BPP (Beckn Provider) | The supply-side app — publishes catalog, fulfils orders. Sub-roles: **MSN** (marketplace, no own inventory) vs **ISN** (inventory seller) | The **distributors** must be here (directly, or via their billing software acting as an SNP) for Salt to have anyone to order from |
| **Gateway (BG)** | — | Multicasts a buyer's search to the relevant sellers (discovery orchestrator) | Infrastructure; not built by us |
| **Technology Service Provider (TSP)** | — | Outsourced tech so a participant can join without building the Beckn stack itself | **The low-effort path** — ride a TSP / white-label buyer-app stack instead of implementing Beckn from scratch |

Plus support roles: Logistics SP (LSP), Reconciliation SP (RSP), and Issue & Grievance Management (IGM / dispute resolution). A **registry** holds every subscriber's record and public keys.

## How a transaction flows (Beckn)

Beckn is a set of **interoperable, asynchronous** API pairs — a request and a matching `on_*` callback — across four phases:

- **Discovery:** `search` → `on_search`
- **Order:** `select` → `on_select`, `init` → `on_init`, `confirm` → `on_confirm`
- **Fulfilment:** `status` / `track` / `update` / `cancel` (each with its `on_*`)
- **Post-order:** `rating`, `support`, and IGM `issue` → `on_issue`

Because each exchange is commercial, **every request and callback is a signed "contract":** the sender signs with an **Ed25519** key and the receiver verifies it against the sender's public key in the registry; payloads are encrypted with an **X25519** key pair. ONDC publishes reference implementations in Java, Python, GoLang, NodeJS, and PHP, so the crypto/auth plumbing need not be hand-rolled.

## B2B on ONDC

ONDC has launched **B2B trade**: manufacturers, wholesalers, and distributors can sell directly to retailers, with the network **unbundling credit and logistics** (the two things that otherwise lock small retailers into a single distributor). The flagship precedent is **HUL's Shikhar** B2B platform integrating with ONDC (FMCG; Madhya Pradesh & Bihar pilot, 2024) so small kirana retailers order directly from HUL through ONDC buyer apps.

The precedent is real but **FMCG, not pharma** — which matters, because medicines carry a regulatory layer FMCG does not.

## Pharma — the regulatory gate

This is the decisive constraint. ONDC treats **Health & Wellness** as a "compliance-driven, trust-sensitive" domain and is, in the industry's words, *"playing it safe with pharmacies"* (The Ken):

- **Only OTC is live, and only B2C.** Of the pharmacies onboarded as sellers, **none sell prescription medicines.** Consumers can buy OTC/wellness items; that is the extent of pharmacy on ONDC today.
- **There is no established B2B-pharma category** — i.e. no retailer↔distributor medicine-ordering domain. The "vendor ordering" use case has no live rail on ONDC.

The regulatory frame behind the caution (and what any pharma B2B on ONDC must satisfy): the **Drugs & Cosmetics Act, 1940**; **wholesale** trade needs **Form 20B** (general) / **21B** (Schedule C & C1) licenses; **retail** needs a drug license; **Schedule H/H1/X** drugs are prescription-bound with special-register and retention duties (see [product/market-research](../product/market-research.md) for the Schedule H/H1/X rules Salt already models). Licensing runs through CDSCO / the ONDLS portal.

## Two plays for Salt (they map to different modules)

ONDC is two opportunities, not one — pointing in opposite directions:

| Play | Direction | Salt's role | Module | Status today |
|---|---|---|---|---|
| **Procurement** — pharmacy orders stock from distributors | Inbound B2B | **Buyer app (BNP/BAP)** | [Module 18 — B2B Ordering Portal](../product/product-modules.md) | **Blocked** — no pharma-distributor seller liquidity on ONDC; no Rx/B2B-pharma category |
| **Retail** — pharmacy lists its own stock, fulfils consumer orders commission-free (vs PharmEasy/Apollo) | Outbound B2C | **Seller app (SNP/BPP)** | [Module 21 — ONDC](../product/product-modules.md) | **Closer to live** — but OTC-only, no Rx |

The original "vendor integration" question is the **procurement / buyer-app** play. The roadmap's existing ONDC entry (Module 21) is the **retail / seller-app** play — a different build with a different counterparty. Both are gated by ONDC's pharma caution.

## How to onboard (for when we pick it up)

Concrete, from ONDC's developer docs and participant portal:

1. **Prereqs:** a **Fully-Qualified Domain Name** (it becomes your `subscriber_id`), a valid **SSL certificate** (used for OCSP validation), and two key pairs — **Ed25519** (signing) + **X25519** (encryption).
2. **Register** on the Network Participant Portal (`portal.ondc.org`): complete the profile 100%, attend the onboarding webinar, then raise an **environment access request** (whitelisting; ~6–48h).
3. **Prove domain ownership:** host `ondc-site-verification.html` containing a signed `request_id`.
4. **Subscribe:** call **`/subscribe`** on the registry, declaring participant type via `ops_no` (**1 = Buyer App, 2 = Seller App, 4 = both**). The registry validates payload schema, SSL (OCSP), domain ownership, and an encrypted **`/on_subscribe`** challenge your endpoint must decrypt and echo.
5. **Promote through environments:** **Staging → Pre-Production → Production**, each with its own whitelisting and a probationary go-live.

**Effort shortcut:** join as a **TSP-backed buyer app** / white-label codebase rather than building the Beckn protocol stack and certification from scratch. Resources: `github.com/ONDC-Official/developer-docs`, `resources.ondc.org/tech-resources`.

## Effort & blockers

The build (Beckn buyer-app endpoints, signing/encryption, registry subscription, per-environment certification) is **non-trivial but bounded** — and largely avoidable via a TSP. The real blockers are **external and not ours to fix**:

- **Seller liquidity:** Salt's pharmacies can only order from distributors who are ONDC sellers. For pharma B2B that population is ~zero today.
- **The Rx gate:** until ONDC opens prescription medicines and a B2B-pharma category, regulated reordering — the actual need — can't run on the network.

Salt's data model is already prepared on the *receiving* side: `purchase_orders` + `po_lines` exist in [proposed-data-model](proposed-data-model.md) as the structural hook for an inbound electronic PO, whatever rail eventually fills them.

## Verdict / when to revisit

**Track, don't build.** Revisit when **either** trigger fires: (1) ONDC opens **Rx / a B2B-pharma category**, or (2) a critical mass of **local distributors onboard as ONDC sellers**. Until then the user-facing need is met by the near-term stopgap in ADR [0016](../decisions/0016-vendor-ordering-channel.md) — a **structured PO → WhatsApp/PDF export** that replaces the phone-call order cycle without any network dependency — and, if electronic ordering is wanted sooner, a **BD partnership with Pharmarack or Retailio** (closed, but live today).

## Related

[decisions/0016 — vendor ordering channel](../decisions/0016-vendor-ordering-channel.md) · [product/product-modules](../product/product-modules.md) (Modules 18, 21) · [product/market-research](../product/market-research.md) (Schedule H/H1/X, ONDC trend) · [domain/parties](../domain/parties.md) (customer/vendor classification) · [proposed-data-model](proposed-data-model.md) (`purchase_orders`/`po_lines`)

## Sources

ONDC roles — [ondc.org/roles-you-can-play](https://www.ondc.org/roles-you-can-play/) · Joining — [ondc.org/ondc-how-to-join](https://www.ondc.org/ondc-how-to-join/) · B2B launch — [ONDC blog](https://www.ondc.org/blog/ondc-launches-b2b-trade-on-its-platform-now-merchants-can-engage-with-other-businesses/) · Onboarding (technical) — [ONDC-Official/developer-docs · Onboarding of Participants](https://github.com/ONDC-Official/developer-docs/blob/main/registry/Onboarding%20of%20Participants.md), [resources.ondc.org/tech-resources](https://resources.ondc.org/tech-resources) · Pharma caution — [The Ken: ONDC is playing it safe with pharmacies](https://the-ken.com/techxpolicy/ondc-is-playing-it-safe-with-pharmacies/), [ondc.org/ondc-buyer-apps](https://www.ondc.org/ondc-buyer-apps/) · Regulatory — [D&C Act licensing](https://www.lawrbit.com/article/procedure-for-applying-drugs-and-cosmetic-license-in-india/), [Form 20B/21B](https://www.agileregulatory.com/blogs/what-is-form-20b-and-21b-drug-license-)
