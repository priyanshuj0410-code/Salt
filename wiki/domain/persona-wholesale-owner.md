---
type: domain
updated: 2026-05-29
tags: [persona, user-research, wholesale, tier2-tier3]
---

# User persona — wholesale medicine shop owner

> "Marg is like an old motorcycle. Every mechanic in town knows how to fix it and I know every shortcut. But it breaks down at the worst possible time and the company stopped caring."

---

## Profile

**Name:** Santosh Agarwal (composite; representative name for a UP/Bihar/MP/Rajasthan wholesale dealer family)
**Age:** 38–52
**Location:** Gorakhpur (UP), Rajkot (Gujarat), Nashik (Maharashtra), Sagar (MP) — any district HQ or divisional town, population 3–15 lakh
**Business:** Licensed wholesale medicine dealer — Form 20B (wholesale) + Form 21B (restricted) under D&C Rules. Sells to retail chemists, hospitals, dispensaries, nursing homes. Does **not** sell to end consumers.
**Scale:** ₹30L–₹2 Cr turnover per month; 2,000–6,000 active SKUs; 80–300 retail chemist customers; 3–5 billing counters; 4–12 staff.
**Software:** Marg ERP 9+ (8–15 years; multiple versions). Sometimes also Tally for final accounts.

---

## Business structure

Santosh is the middle link in the Indian pharma supply chain:

```
Pharma Company → C&F Agent (state/city level) → Santosh (wholesale dealer) → Retail chemist
```

He buys from 15–30 companies or their C&F agents; he sells to 80–300 retail chemists in his town and surrounding villages. His job is essentially **logistics, credit, and trust**: he stocks the right drugs so chemists can call him and pick up or get delivery within the hour.

His margins are thin (typically 8–15% on purchase; schemes and cash discounts are where the money is made). Volume and velocity are everything — slow-moving stock and expired goods are losses he absorbs personally.

He employs:
- 2–4 billing counter staff (his most important employees; turnover is high)
- 1–2 godown/warehouse staff
- 1–2 delivery boys / rickshaw
- 1 accountant (part-time or shared with the family business)
- Sometimes 1–3 field salesmen who visit retail chemists

---

## The shop

A typical wholesale medicine shop sits in the "dawa bazaar" — a cluster of 10–50 wholesale dealers on the same street, often near the district hospital or the main market. The shop is 600–1,500 sq ft. The front has 3–5 billing counters (high wooden desks, each with a computer terminal). Behind the counters is floor-to-ceiling racking — alphabetically organised by company or molecule. The godown (stock room) is adjacent or a floor above.

Between 9 AM and 1 PM, 5–15 retail chemists are in the shop simultaneously: some waiting at counters for their order to be billed, some walking the racks, some on the phone with their own shops. It is loud, fast, and physical.

---

## A day in the life

**6:30–8:00 AM:** Distributor vehicles arrive with stock. Godown staff unload; Santosh or a senior counter staff checks the challan against actual boxes. Batch numbers, expiry dates, and quantities are verified. Discrepancies are flagged immediately — a short supply discovered a day later is an argument.

**8:00–9:00 AM:** He checks the previous day's closing stock in Marg. Checks who paid (mobile banking notifications on his phone). Flags overdue accounts. Calls 2–3 chemists whose accounts are 45+ days old. Places purchase orders with 3–4 distributors via WhatsApp (sends the order as a typed list, not electronically).

**9:00 AM–1:00 PM:** Peak billing. All counters running. Retail chemists queue up with handwritten order slips or call in orders. Counter staff bill on Marg, print the invoice on dot-matrix or thermal printers, hand-write the goods challan if the stock needs to be picked from the rack. Santosh circulates — checks billing, resolves out-of-stock situations (substitutes same molecule/different brand), takes calls from chemists asking if a particular batch or pack size is available.

**1:00–3:00 PM:** Lunch break, but billing continues at reduced pace. Returns processed — retail chemists bring back near-expiry or broken items. Each return is painful: a credit note must be issued, the stock re-entered, and the return-to-supplier claim initiated separately. This often piles up until end of week.

**3:00–5:00 PM:** Accountant arrives. Previous day's entries reconciled. Marg's day-end closing run. Outstanding payment follow-up. GST preparation (monthly, first week).

**5:00–7:30 PM:** Second peak. Evening deliveries dispatched. New stock arriving from afternoon distributor vehicles.

**7:30–9:00 PM:** Santosh reviews the day — what didn't move, what ran out, what schemes are ending. WhatsApp messages to chemist customers ("Cipla 10+1 scheme ending this week, last date Friday"). Checks tomorrow's bank balance for payment commitments.

---

## Keyboard proficiency — the Marg mental model

Santosh has used Marg for over a decade. His fingers move without thought:

| Shortcut | Action |
|---|---|
| `F2` | Open new sale bill |
| `F3` | Purchase voucher entry |
| `F4` | Purchase / sale return |
| `F5` | Stock query by item |
| `F8` | Day book / reports |
| `Alt+C` | Create party / item on the fly mid-entry |
| `Ctrl+F` | Find / search |
| `PgUp/PgDn` | Navigate previous bills |
| `Enter` | Confirm / move to next field |
| `Esc` | Cancel / go back |
| `Tab` | Next field |
| `Ctrl+P` | Print current bill |

He types the first 3–4 characters of a drug name and expects the system to auto-complete to the right item with the right batch. He expects `Tab` to move him to the quantity field, and `Enter` to confirm and move to the next line. Any deviation from this flow — a mouse click required mid-entry, a dialog box interrupting his keystroke stream — breaks his rhythm and earns the software a curse word.

His counter staff are trained the same way. A new employee is "trained on Marg" within 2–3 days; by week two they match an experienced biller's speed. The keyboard-first workflow is the knowledge that transfers.

**What "fast billing" means to him:** A typical chemist's order is 20–40 line items. It should be billed in 4–7 minutes. If it takes 10 minutes, the chemist waiting behind gets impatient and calls a competitor. Speed is directly correlated with revenue.

---

## Internet situation

He has Jio broadband at the shop — nominally 30 Mbps. In practice:

- **2–5 drops per day**, each lasting 5–30 minutes
- **Monthly outages** of 2–6 hours, often unexplained
- **Monsoon season** is worse — the router and the optical fibre in the street don't handle rain well
- **Backup**: his personal mobile phone as a hotspot (Airtel or Jio SIM). He or the counter staff connect a terminal to the hotspot manually. This works but is slow and expensive; he won't run all 4 counters on the hotspot simultaneously.

His relationship with internet reliability: "It works most of the time. But 'most of the time' is not good enough for billing." He has been burned once by a cloud accounting tool (MargBooks or similar) during GST return filing week — the internet was down for 4 hours exactly when the deadline was near.

**What he wants:** The software to work when the internet is down. Not "show an error and wait" — actually work. If a chemist is standing at the counter with 30 items, Santosh expects to bill him whether or not Airtel's tower is having a bad day. The internet can sync the data after; billing must not stop.

---

## The five jobs he hires software to do

These are the concrete jobs-to-be-done, ordered by daily urgency:

**1. Bill fast without stopping**
Generate a correct GST invoice in under 5 minutes for any order, with the right batch, right price, right scheme applied, without the internet.

**2. Know who owes me money right now**
At any moment he should be able to see: which chemist owes how much, since when, what their credit limit is, whether they've paid recently. When a chemist calls to order, he decides whether to give credit based on this number. "Unka ₹45,000 baaki hai to usse ek naya order nahi dunga jab tak clear nahi karta."

**3. Know what I have and what's about to expire**
Stock that sits past expiry is a direct loss. He needs to know at least 60 days ahead so he can push the stock: sell it faster, run a scheme, or initiate a return to the distributor.

**4. File GST without the accountant spending a week on it**
Every month, the accountant spends 2–4 days reconciling purchase invoices, matching GSTR-2B, calculating CGST/SGST, generating the GSTR-1 JSON. This is manual, error-prone, and expensive. He wants the software to generate the GST file he can just upload.

**5. Not get in trouble with the drug inspector**
Schedule H1 register, drug license currency, stock records — when the inspector comes (and they do come), he needs to produce clean records in 30 minutes. Currently the H1 register is kept manually in a paper register because his counter staff don't fill it in the software reliably. He lives with the anxiety.

---

## Credit management — the emotional core of the business

Santosh's business runs on credit. Most retail chemists pay in 30–45 days. Some in 60. A few in 90+. He has ₹20–80 lakhs outstanding in receivables at any given time. This is his biggest source of stress and his biggest operational risk.

He mentally tracks his top 20–30 customers' payment behaviour. He knows Ramesh Medical always pays on the 10th. He knows City Pharma has been slow since their shop renovation. He knows the government dispensary pays quarterly and only if chased.

The ledger in the software is his ground truth. When it's wrong — a payment recorded in the bank but not entered in Marg, a credit note not yet linked to a sale — his decisions are wrong. He has made collection calls to chemists who had already paid, which is embarrassing. He has extended credit to chemists who were already over-limit, which has cost him.

---

## Purchase and schemes — the complexity he manages

He buys from 15–30 companies / C&F agents. Each has:
- A price list (MRP fixed, PTR varies by company, cash discount varies)
- Schemes: "10+1 on strip pack", "flat 12% extra margin on launch SKUs", "10% CD on quarterly billing of ₹5L+"
- Payment terms: typically 30–45 days from bill date
- Return policies: near-expiry returns accepted within 3 months of expiry; broken goods within 7 days

He tracks this in his head and in WhatsApp messages. No current software helps him capture scheme terms and check whether the scheme was applied correctly on a purchase invoice. Discrepancies are discovered weeks later during manual reconciliation.

---

## Frustrations with current tools

**Marg — multi-counter limitation**: Marg 9+ is designed for a single machine. "Networking" via LAN is available but unstable — if one terminal crashes, the shared Marg database can corrupt. In practice, many wholesale dealers run **two separate Marg installations** on two LAN-disconnected terminals, manually synchronising at end of day. This means Counter 1 doesn't know what Counter 2 has billed. Stock is reconciled only at night. A chemist can buy the same last unit from both counters.

**H1 register kept on paper**: The software's H1 register entry flow is not enforced — counter staff skip it, especially during peak hours. The paper register is the backup. When an inspector comes, there is a scramble. "Mujhe pata hai ki yeh galat hai, par billing rokke to nahi banta subah 11 baje mein."

**GST reconciliation is manual**: The accountant downloads GSTR-2B, exports purchase entries from Marg, and matches them in Excel. Every month. Every mismatch is investigated manually. Distributors who file late cause retrospective corrections. He has faced ITC reversal notices because of distributor filing errors he had no visibility into.

**Expired stock**: The near-expiry alert in Marg exists but is buried in a report. Counter staff don't check it. He discovers expired stock during a physical count — usually too late to return, past the distributor's return window. The stock is written off. ₹5,000–₹30,000 per month in most wholesale shops.

**No visibility across counters**: He walks to each terminal to see the day's billing. There's no owner dashboard. He cannot see all four counters simultaneously or view the day's total sales without running a report on each machine.

**Support**: Marg's local AMC partner has changed twice. Current one picks up calls 50% of the time. Remote support means TeamViewer sessions that take 45 minutes to resolve a 5-minute problem. The AMC cost went from ₹2,500 to ₹5,500 last renewal.

---

## What "good software" looks like to him

- **Keyboard-first, always**: every action reachable without a mouse. He will evaluate Salt in the first 60 seconds by typing a drug name and pressing Enter. If it doesn't work exactly as expected, he will not continue the demo.
- **Uninterrupted billing offline**: non-negotiable. If he hears "you need internet to bill", he stops listening.
- **All counters see the same stock**: the moment Counter 2 bills a unit, Counter 1 should know it's gone.
- **WhatsApp ledger statement**: send a chemist their outstanding ledger via WhatsApp in one click. No printing, no PDF email — WhatsApp.
- **GST export that just works**: give the accountant a file to upload, not a pile of data to re-enter.
- **Near-expiry surfaced automatically**: not in a report he has to remember to run — surfaced on the billing screen ("3 batches of Augmentin 625 expire in 45 days, want to prioritize?").
- **Drug inspector readiness**: pull up the H1 register for any date range and print it in 2 minutes.

---

## What will make him switch from Marg

He is not looking to switch. Marg is known. His counter staff know it. His accountant knows it. Switching has a cost (training, migration, 3 months of parallel running). He switches when:

1. **A pain becomes unbearable** — an expired-stock loss that the software would have prevented, a drug inspector fine, a counter conflict that loses a big customer
2. **A trusted peer switches** — if his counterpart in the neighbouring shop switches and becomes visibly faster/better, he will ask what they are using
3. **The demo is viscerally better** — he must feel within 5 minutes that the new tool is faster for counter billing. If the billing flow is slower or requires more clicks, nothing else matters
4. **Migration is handled for him** — the Go migrator approach (Marg DBF → Salt) must be seamless; he will not manually re-enter 5,000 items and 300 party balances

---

## Design implications for Salt

| His reality | Salt must |
|---|---|
| Keyboard is the interface | Every billing action reachable without mouse; F-key or single-key triggers for common flows |
| 3–5 simultaneous counters | Real-time stock sync across all sessions; a unit sold on Counter 2 must be gone from Counter 1 immediately |
| Internet drops 2–5×/day | Offline-first: local state is the source of truth during outages; sync on reconnect; no "offline mode" banner that blocks work |
| H1 register kept on paper due to software friction | Hard gate at billing for H1/X drugs: block invoice completion until required fields are filled — not a soft warning |
| GST reconciliation costs 2–4 accountant-days/month | GSTR-1/3B JSON export; GSTR-2B auto-match against purchase entries |
| Near-expiry = unnoticed loss | Surface near-expiry batches proactively in the billing flow, not buried in a report |
| WhatsApp is primary communication | One-click WhatsApp share for invoice, ledger statement, payment reminder |
| Credit management is the emotional core | Ledger balance, credit limit, days overdue visible at the party level before billing |
| Switching cost is high | Marg DBF migration must be zero-touch; the Go migrator is the answer to this objection |
| Counter staff turnover is high | Billing flow must be learnable in 2–3 days; keyboard shortcuts must be consistent and documented |

## Related
[domain/medical-retail](medical-retail.md) · [product/market-research](../product/market-research.md) · [product/roadmap](../product/roadmap.md) · [architecture/billing-screen](../architecture/billing-screen.md) · [decisions/0002-stack-divergence-from-prd](../decisions/0002-stack-divergence-from-prd.md)
