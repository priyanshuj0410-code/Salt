---
type: architecture
updated: 2026-06-01
tags: [integrations, razorpay, payments, collections]
---

# Razorpay integration (payment links)

The integrations module's collections surface (SALT-108). Implements the
Razorpay half of [product-modules §7](../product/product-modules.md): generate a
hosted payment link for a customer's outstanding and send it over the
[WhatsApp seam](integrations-whatsapp.md), so the receipt can later auto-apply to
their ledger.

## Why an edge function (not a client SDK)

Razorpay's **secret key** can only be used server-side. Link creation therefore
goes through the `razorpay-link` edge function, which Basic-auths
(`key_id:key_secret`) to `api.razorpay.com/v1/payment_links`. The client
([`lib/razorpay.ts`](../../apps/web/src/lib/razorpay.ts)) only knows the
function's URL and the **publishable** `key_id` (safe on the client) — never the
secret (per the [stack](stack.md) secrets rule).

```
RazorpayPage ── createPaymentLink ── POST {endpoint} ── razorpay-link fn ── Razorpay API
                     │                                   (adds Basic auth)        │
                     └─ not configured? → clear error          short_url ◄────────┘
```

Money is **integer paise**, which is exactly Razorpay's `amount` unit — no
conversion, no float drift. `buildPaymentLinkRequest` is pure and smoke-tested.

## Surfaces

- [`components/integrations/RazorpayPage.tsx`](../../apps/web/src/components/integrations/RazorpayPage.tsx) — connection panel (key id / enable / endpoint) + a composer that creates a link from amount/customer/phone and offers Copy + **Send link on WhatsApp** via the SALT-107 [`WhatsAppButton`](../../apps/web/src/components/integrations/WhatsAppButton.tsx).

## Boundaries / follow-ups (filed, not done in-lane)

- **SALT-230** (integrations) — `razorpay-webhook` edge function: verify the HMAC signature and, on `payment_link.paid`, call `record_payment` (idempotent) so the receipt auto-applies to the party's ledger. Resolves via `notes.reference_id` set by `buildPaymentLinkRequest`. Touches payments/DB.
- **SALT-231** (parties/payments) — wire "Create payment link" into a party's outstanding / reminder flow.
- Deploy: `supabase functions deploy razorpay-link` + `supabase secrets set RAZORPAY_KEY_ID … RAZORPAY_KEY_SECRET …`. Until then the existing UPI deep link (`lib/collection.ts upiPayUrl`) is the zero-setup collection path.

## Related
[architecture/integrations-whatsapp](integrations-whatsapp.md) (delivery seam) ·
[architecture/payments](payments.md) (`record_payment`, the ledger target) ·
[product/product-modules](../product/product-modules.md) §7
