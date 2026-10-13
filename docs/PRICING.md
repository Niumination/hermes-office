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
This repo carries 366 backend tests and 102 machine-verified documentation
claims precisely because these parts are easy to get *almost* right.

**Compared to competitors.** Langfuse Enterprise is $2,499/year for tracing
and eval. The $2,000 figure is not a discount against them — it is a
different product in an adjacent category, and it is deliberately not
cheaper. A lower price would signal "helper tool", when what is being bought
is proof.

## Every number on this page is executable

Pricing pages are where claims go to rot: they are written once, read by
everyone, and checked by no one. This one is wired to the repository.

The test counts, the claim counts and the asset counts quoted here are read
out of this file by `scripts/check-docs.py` and compared against what the
runners actually report. If this page and the code disagree, CI fails. The
English and Indonesian versions are held to the same figures, because a
translation is a second place for a claim to rot.

You do not have to take that on trust either:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office && npm ci && npm run verify
```

17 gates, about 4 minutes on a 2-core machine. The gate list and what each
one proves is in the [README](../README.md#verify-it-yourself).

This is the actual product. An isometric office can be copied in a week; a
vendor who lets you execute their marketing cannot be copied at all without
doing the same work. What is being sold at $2,000+ is not the picture — it is
that every sentence attached to it has been made falsifiable, and left that
way.

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
  Named explicitly, so nobody has to ask by email: there is no SOC 2 report,
  no ISO 27001 certification, no HIPAA BAA, no signed DPA, no third-party
  penetration test. What exists is a CycloneDX SBOM rebuilt on every CI run
  (`sbom.cdx.json`), a tamper-evident ledger, and a documented threat model.
  Those are inputs to an assessment, not a substitute for one.
- **Tamper-proof.** Tamper-evident. It says so in the UI.
- **An uptime or response-time SLA.** You host it. The one timing commitment
  made anywhere is the disclosure window in
  [`SECURITY.md`](SECURITY.md#11-coordinated-disclosure), and that is a
  promise to answer, not a promise to fix.
- **Support for a Node version that is not in the CI matrix.** The supported
  set is exactly two versions and is listed in [`SUPPORT.md`](SUPPORT.md).

Every item above could be sold by writing a sentence. None of them is, which
is the only reason the sentences on the rest of this page are worth
anything.
