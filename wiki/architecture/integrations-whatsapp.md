---
type: architecture
updated: 2026-06-01
tags: [integrations, whatsapp, messaging, notifications]
---

# WhatsApp integration (send infra + templates)

The integrations module's first surface (SALT-107). Implements
[product-modules §14 — WhatsApp Integration](../product/product-modules.md) and
Phase 4 of the build sequence. WhatsApp is how Indian pharmacies actually share
bills and chase payments, so this is the highest-leverage integration to ship
first — and the only one buildable with **zero third-party credentials**.

## Two transports behind one seam

| Transport | When | Needs |
|---|---|---|
| **Click-to-chat** (`wa.me`) | default, today | nothing — opens WhatsApp with the message pre-filled |
| **Business (Cloud) API** | opt-in per shop | the `whatsapp-send` edge function + Meta secrets |

`sendWhatsApp({ phone, text })` in [`lib/whatsapp.ts`](../../apps/web/src/lib/whatsapp.ts)
picks the transport: if the shop has enabled the Business API **and** set an
endpoint, it POSTs the Graph payload to the edge function; otherwise it returns a
`wa.me` URL for the caller to open. Callers never branch on the mode.

```
caller ── sendWhatsApp ──┬─ cloud-api ready? ── POST {endpoint} ── edge fn ── Graph API
                         └─ else ───────────── { url: wa.me/… }  ── window.open
```

## What already existed (reused, not rebuilt)

The `wa.me` primitives and the two oldest message builders predate this ticket
and are reused verbatim so wording never drifts:

- `normalizePhoneForWa`, `whatsappUrl` — [`lib/collection.ts`](../../apps/web/src/lib/collection.ts) (re-exported from `lib/whatsapp.ts`).
- `reminderMessage` (payment reminder) — `lib/collection.ts`.
- `buildBillShareText` (invoice share) — [`lib/billShare.ts`](../../apps/web/src/lib/billShare.ts).

> `lib/messages.ts` is **unrelated** — it's the internal staff chat thread
> (entity_messages, SALT-105), not outbound WhatsApp.

## Template registry

`WHATSAPP_TEMPLATES` in `lib/whatsapp.ts` — one typed catalog for the four
Module-14 use cases. Each entry has editable `fields` (with samples), a `build()`
that renders the body, and a `cloudTemplateName` (the name to register in Meta's
WhatsApp Manager for the Business API path). The two pre-existing builders are
delegated to; two are new here:

| id | audience | builder | new? |
|---|---|---|---|
| `invoice_share` | customer | `buildBillShareText` | reused |
| `payment_reminder` | customer | `reminderMessage` (+ UPI pay link) | reused |
| `ledger_statement` | customer | `ledgerStatementMessage` | new |
| `near_expiry_vendor` | vendor | `nearExpiryVendorMessage` | new |

## Cloud API boundary

The Meta token + phone-number-id are secrets, so they live **only** in the
[`whatsapp-send` edge function](../../supabase/functions/whatsapp-send/index.ts)
— never the client (per [stack](stack.md) secrets rule). The client builds the
Graph message (`buildTextPayload` / `buildTemplatePayload`) and the function adds
auth and forwards to `graph.facebook.com/v21.0/<id>/messages`. Deploy:

```
supabase functions deploy whatsapp-send
supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=…
```

## Surfaces

- [`components/integrations/WhatsAppPage.tsx`](../../apps/web/src/components/integrations/WhatsAppPage.tsx) — connection config (mode, sender name, endpoint) + a per-template composer/preview against a recipient.
- [`components/integrations/WhatsAppButton.tsx`](../../apps/web/src/components/integrations/WhatsAppButton.tsx) — the reusable send atom; disabled when the phone isn't a valid mobile.

## Config & persistence

Connection config is held in `localStorage` (`salt.whatsapp.config`) for v1 — it
carries **no secret** (sender name, an enabled flag, the public endpoint URL), so
this is safe and migration-free. A future move to org-level settings (multi-device)
is the natural follow-up if the Business API sees real use.

## Boundaries / follow-ups (filed, not done in-lane)

- **SALT-222** (nav) — add the route + nav entry so `WhatsAppPage` is reachable.
- **SALT-223** (consumers) — migrate the inline `wa.me` opens in parties / payments / bills / GRN onto `WhatsAppButton` / `sendWhatsApp` so every send respects the connection mode.

## Related
[product/product-modules](../product/product-modules.md) ·
[architecture/payments](payments.md) (UPI pay link in reminders) ·
[architecture/stack](stack.md) (edge functions, secrets) ·
[architecture/realtime](realtime.md) (the other Supabase server-side surface)
