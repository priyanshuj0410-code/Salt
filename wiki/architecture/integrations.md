---
type: architecture
updated: 2026-06-02
tags: [integrations, whatsapp, razorpay, payments, edge-functions]
---

# Integrations module

How Salt talks to outside services. Two are shipped — **WhatsApp** and **Razorpay** — implementing [product-modules](../product/product-modules.md) §14 and §7; the rest are gated on credentials or partners. Per-integration detail: [integrations-whatsapp](integrations-whatsapp.md), [integrations-razorpay](integrations-razorpay.md).

> **State note (2026-06-02):** Razorpay was built **twice in parallel** — SALT-108 (this module: a standalone composer) and SALT-169 (database lane: the payments-integrated path). They overlap; see [Contradictions](#contradictions--cleanup). Documenting the as-built honestly rather than the intent.

## Design tenets
The pattern every integration here follows:

1. **Credential-optional, graceful degradation.** Each integration works (or no-ops cleanly) with zero setup, and upgrades to a server API when the owner configures it. WhatsApp falls back to click-to-chat (`wa.me`); Razorpay link-creation reports "not configured" while the UPI deep link (`lib/collection.ts` `upiPayUrl`) stays the zero-setup collection path.
2. **The Supabase Edge Function is the secret boundary.** Third-party secrets (Meta token, Razorpay key secret, webhook secret) live only in edge-function env — never the browser (per [stack](stack.md) secrets rule). The client calls our function; the function adds auth and forwards.
3. **Client config in `localStorage`, holding no secret** (`salt.whatsapp.config`, `salt.razorpay.config`) — so the feature is migration-free. Multi-device config is a deferred follow-up.
4. **Reuse existing domain primitives** rather than re-implement: `lib/collection.ts` (`whatsappUrl`, `normalizePhoneForWa`, `reminderMessage`), `lib/billShare.ts` (`buildBillShareText`), `record_payment` / `record_gateway_payment` (payments).
5. **The integrations compose.** A Razorpay link is delivered over the WhatsApp send seam (`WhatsAppButton` + `paymentLinkMessage`).

## What is built

### WhatsApp — SALT-107 (routed)
One `sendWhatsApp()` seam over two transports (click-to-chat default; opt-in Business/Cloud API via `whatsapp-send`) + a typed template registry for the four §14 use cases. `WhatsAppPage` is reachable at **`/settings/integrations/whatsapp`** (routed by SALT-222), gated to the owner. `WhatsAppButton` is the reusable send atom. Full design: [integrations-whatsapp](integrations-whatsapp.md).

### Razorpay — SALT-108 + SALT-169 (partly wired)
Payment links for collections. **Two implementations exist:**
- **SALT-108** (this module): `lib/razorpay.ts` (`buildPaymentLinkRequest` → `createPaymentLink` against a config-driven `razorpay-link` endpoint) + `RazorpayPage` composer. **`RazorpayPage` is NOT routed** (SALT-222 wired only WhatsApp) — currently unreachable.
- **SALT-169** (database lane): `razorpay-paylink` (party-centric `{party_id, amount_paise}`, RLS-scoped, meant for the Payments client) + `razorpay-webhook` → `record_gateway_payment`. Backend is live; **no frontend caller exists yet**.

Design notes: [integrations-razorpay](integrations-razorpay.md).

## Key files

| File | Purpose | Ticket |
|---|---|---|
| `apps/web/src/lib/whatsapp.ts` | Send seam, Cloud API payloads, template registry | 107 |
| `apps/web/src/components/integrations/WhatsAppPage.tsx` | Connection config + per-template composer (routed) | 107 |
| `apps/web/src/components/integrations/WhatsAppButton.tsx` | Reusable send atom | 107 |
| `apps/web/src/lib/razorpay.ts` | Config + payment-link request builder + `createPaymentLink` | 108 |
| `apps/web/src/components/integrations/RazorpayPage.tsx` | Razorpay connection + link composer (**unrouted**) | 108 |
| `supabase/functions/whatsapp-send/` | Cloud API forwarder | 107 |
| `supabase/functions/razorpay-link/` | Generic Payment Links creator (config-driven) | 108 |
| `supabase/functions/razorpay-paylink/` | Party-centric Payment Links creator (RLS) | 169 |
| `supabase/functions/razorpay-webhook/` | HMAC verify → `record_gateway_payment` | 169 |

## Data model + RPCs

WhatsApp and the SALT-108 Razorpay client have **no DB footprint** — config is `localStorage`, and the WhatsApp transports either deep-link or post to an edge function. The only schema is SALT-169's gateway capture:

- **`0042_gateway_payment.sql`** — adds `payments.gateway` + `payments.gateway_ref` with a unique index on `(org_id, gateway, gateway_ref)` (idempotency), and `record_gateway_payment(p_org_id, p_party_id, p_amount_paise, p_gateway, p_gateway_ref, p_shop_id, p_reference)`: a **service-role-only**, org-explicit, idempotent RPC that posts a `received` UPI payment (Dr bank = Cr party). Org is explicit because the webhook authenticates by HMAC, not a JWT, so `record_payment` (which derives org from `auth.uid()`) can't be used.
- **`0046_owner_rpc_guards.sql`** — owner-RPC guards covering the gateway path.

## Contradictions / cleanup
*(flagged per the wiki convention — these are real overlaps, not a plan)*

- **Two Razorpay link creators.** `razorpay-link` (108, generic body, config endpoint, called by the unrouted `RazorpayPage`) vs `razorpay-paylink` (169, `{party_id, amount_paise}`, RLS, webhook-reconciled). Their request contracts are incompatible. **Recommend** consolidating on the SALT-169 path (it has RLS + idempotent webhook reconciliation) and either retiring `razorpay-link`/`lib/razorpay.ts`/`RazorpayPage` or repointing them at `razorpay-paylink`.
- **`RazorpayPage` is unrouted** — SALT-222 routed only WhatsApp. Either route it or fold its composer into the payments collection flow.
- **SALT-230 is superseded.** The planned "Razorpay webhook → reconciliation" (SALT-230) is already delivered by SALT-169 (`razorpay-webhook` + `record_gateway_payment`). Recommend closing SALT-230 as a duplicate.

## Current state vs planned

| Status | Item |
|---|---|
| **Built** | WhatsApp (107, routed) · Razorpay link infra (108) · gateway capture webhook + RPC (169) |
| **Open** | SALT-223 (route consumer screens through the WhatsApp seam) · SALT-231 (collection-flow "Create payment link" — the missing UI caller for `razorpay-paylink`) · route or retire `RazorpayPage` |
| **Superseded** | SALT-230 (by SALT-169) |
| **Gated** | SALT-109 GSTN/GSP (needs a GSP + GST API creds; would reuse `buildGstr1Json`/`buildGstr3bJson` + `lib/gstr2b.ts`) · SALT-110 distributor APIs (no self-serve API — [ADR 0016](../decisions/0016-vendor-ordering-channel.md)) · SALT-111 bank feed via Account Aggregator (v1.1, needs FIU/AA partner) |

## Setup runbook
Each integration is inert until its edge function is deployed and secrets are set.

- **WhatsApp Business API:** `supabase functions deploy whatsapp-send`; set `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`; enable + set the endpoint URL in Settings → Integrations → WhatsApp. *(Skip entirely to use click-to-chat.)*
- **Razorpay (SALT-169 path):** run migrations `0042`/`0046`; `supabase functions deploy razorpay-paylink razorpay-webhook`; set `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (paylink) and `RAZORPAY_WEBHOOK_SECRET` (webhook); deploy the webhook with `verify_jwt = false`; register the webhook URL in the Razorpay dashboard.

## Related
[integrations-whatsapp](integrations-whatsapp.md) · [integrations-razorpay](integrations-razorpay.md) · [payments](payments.md) (`record_payment`, the ledger target) · [stack](stack.md) (edge functions, secrets) · [product/product-modules](../product/product-modules.md) §7 + §14 · raw: `salt-prd-v0.3.md`, ADR [0016](../decisions/0016-vendor-ordering-channel.md).
