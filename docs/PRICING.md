# Pricing & packaging

**English** · [Bahasa Indonesia](PRICING.id.md)

| | Free | Solo Pro | Team | Enterprise |
|---|---|---|---|---|
| | **$0** | **$39** once | **$299** once | **$2,000+**/year |
| | forever | perpetual licence | perpetual licence, ≤10 people | contract |
| Office, room policy, burn-rate | ✅ | ✅ | ✅ | ✅ |
| OTLP ingest, approval gate | ✅ | ✅ | ✅ | ✅ |
| Flight recorder (hash chain) | ✅ | ✅ | ✅ | ✅ |
| Compliance dossier | — | ✅ | ✅ | ✅ |
| Time Machine (replay) | — | ✅ | ✅ | ✅ |
| Kiosk mode, standup | — | ✅ | ✅ | ✅ |
| External anchoring (webhooks) | — | — | ✅ | ✅ |
| Custom policy, theming | — | — | ✅ | ✅ |
| SSO, SLA support | — | — | — | ✅ |
| Audit evidence pack assistance | — | — | — | ✅ |

## Never per seat

This is a decision, not an oversight, and it turns down money on the table.

A governance tool that bills per seat punishes you at exactly the moment you
do the right thing: inviting the compliance officer, showing legal, giving an
external auditor read access, putting a screen on the wall where the whole
company can see it. Every additional seat makes your fleet **more**
governed, and charging for it means selling a product that argues against
its own purpose.

LangSmith charges $39/seat plus per-trace. Laminar moved to unlimited seats
in 2026, and that is the right direction.

## Why perpetual licences, not subscriptions

The buyer who wants this is not buying a service — they are buying the
ability to prove something later. An artifact whose evidence disappears when
a credit card expires is not evidence.

Your audit chain is a SQLite file on your disk. The dossier is Markdown. Both
remain readable after we are gone, and that is part of what you are paying
for. Subscription applies only to Enterprise, and what it buys there is
support and SSO, not access to your own data.

## The argument for $2,000+

The right question is not "is this expensive" but "compared to what".

**Compared to a fine.** EU AI Act Article 99(4): **€15 million or 3% of
global turnover**, whichever is higher. Article 12(1) requires automatic
logging across the lifecycle; Articles 19 and 26(6) require those logs be
kept at least six months. High-risk obligations have been in force since
**2 August 2026.** This tool does not make you compliant — no software
can — but it produces the kind of artifact those logging articles ask for, in
a format someone else can verify.

**Compared to one incident.** 96% of enterprises exceed their AI cost
projections and only 44% have guardrails (IDC, Dec 2025). A single agent
spinning in a retry loop overnight clears this price. The standup surfaces
that loop as a named finding; the budget cap stops it before morning.

**Compared to building it.** A hash chain done correctly, redaction that is
actually tested, a guest contract that does not leak in one of the two places
it lives, a deterministic replay usable as evidence. That is not a sprint.
This repo carries 305 backend tests and 92 machine-verified documentation
claims precisely because these parts are easy to get *almost* right.

**Compared to competitors.** Langfuse Enterprise is $2,499/year for tracing
and eval. The $2,000 figure is not a discount against them — it is a
different product in an adjacent category, and it is deliberately not
cheaper. A lower price would signal "helper tool", when what is being bought
is proof.

## The open-core boundary

The core is MIT and stays that way: the office, room policy, burn-rate, OTLP,
approvals, and the **flight recorder**.

The audit chain is in the free tier on purpose. Moving log integrity behind a
paywall means selling safety to whoever can most afford it, and would cost
this project the right to argue the way it does in `SECURITY.md`.

What is paid for is the **artifact** layer — dossier, replay, kiosk,
standup — plus anchoring and support. All of it is built *on top of* the
chain; none of it is required for the chain to be correct.

## What is not for sale

- **Access to your data.** No outbound telemetry. The only outbound call is
  the anchor webhook you configure yourself.
- **A compliance guarantee.** We produce evidence; your assessor judges it.
- **Tamper-proof.** Tamper-evident. It says so in the UI.
