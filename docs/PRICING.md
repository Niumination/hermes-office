# Pricing & packaging

**English** · [Bahasa Indonesia](PRICING.id.md)

There are no tiers, no seats and no price list. This is one person's office,
self-hosted, MIT, and every surface in it answers to a single owner token.

That is a retraction. This page used to carry four tiers — Free at $0, Solo
Pro at $39, Team at $299, Enterprise at $2,000+ — with the dossier, replay,
kiosk and standup held behind the paid ones, and a long argument for why
$2,000 was the right number against an EU AI Act fine. The argument was
coherent. It was also describing a product with customers, a support
contract and a Team plan for ten people, none of which exist.

The cost of pretending otherwise was not just embarrassment. A Free tier
implies a visitor who is not the buyer, and that implication is exactly where
the guest role came from: an auto-minted read-only session so a prospect
could see the office without a token, and a redaction pipeline across a dozen
files to keep that session from reading anything real. A product shape that
nobody asked for grew a security boundary that nobody needed, and the
boundary leaked once before it was removed. The packaging was not
decoration — it was load-bearing in the wrong direction.

What remains is true: the core is MIT, the audit chain is a SQLite file on
your own disk, the dossier is Markdown, there is no outbound telemetry, and
nothing here expires. Not because that is generous positioning, but because
there is no mechanism in the repository that could do anything else.

## Every number on this page is executable

Pricing pages are where claims go to rot: they are written once, read by
everyone, and checked by no one. This one is wired to the repository, and it
stayed wired after the prices were deleted — the checker does not care what
the sentences are selling, only whether they are true.

The test counts, the claim counts and the asset counts quoted here are read
out of this file by `scripts/check-docs.py` and compared against what the
runners actually report. If this page and the code disagree, CI fails. The
English and Indonesian versions are held to the same figures, because a
translation is a second place for a claim to rot.

This repo carries 386 backend tests and 119 machine-verified documentation
claims, precisely because a hash chain done correctly, authorization that
holds on both REST and WebSocket rather than one of the two places it lives,
and a deterministic replay usable as evidence are all easy to get *almost*
right.

You do not have to take that on trust either:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office && npm ci && npm run verify
```

18 gates, about 4 minutes on a 2-core machine. The gate list and what each
one proves is in the [README](../README.md#verify-it-yourself).

An isometric office can be copied in a week. What cannot be copied without
doing the same work is a tree where every sentence attached to it has been
made falsifiable and left that way. That property is the point, and it
survives the tiers being deleted — it was never what the tiers were selling.

## Never per seat

Kept as a rule even with nothing to charge for, because it is the thing most
likely to be reinvented the moment there is.

A governance tool that bills per seat punishes you at exactly the moment you
do the right thing: inviting the compliance officer, showing legal, giving an
external auditor read access. Every additional reader makes a fleet **more**
governed, and charging for it means shipping a product that argues against
its own purpose.

Note the shape of the mistake this repo already made in the other direction.
"Let an extra reader in for free" became an auto-minted guest session, which
became a redaction pipeline, which became the only thing standing between a
public tunnel and the fleet's budget. Not charging for readers is right. It
does not follow that readers should be free to authenticate.

## Why nothing expires

The reason to run this is not to buy a service — it is to be able to prove
something later. An artifact whose evidence disappears when a credit card
expires is not evidence.

Your audit chain is a SQLite file on your disk. The dossier is Markdown. Both
remain readable after this repository is gone.

## There is no open-core boundary

There was one. The office, room policy, burn-rate, OTLP, approvals and the
flight recorder were MIT; the dossier, replay, kiosk and standup were the
paid artifact layer. Everything is MIT now, which is what the licence file
always said, and the kiosk no longer exists at all.

Keeping log integrity out of the paid half was the one part of that split
worth preserving as a rule rather than a tier: moving it behind a paywall
would mean selling safety to whoever can most afford it, and would cost this
project the right to argue the way it does in `SECURITY.md`.

## The claim this page used to make

The old version argued its $2,000 tier against EU AI Act Article 99(4) —
**EUR 15 million or 3% of global turnover** — and against Article 12(1),
which requires automatic logging across the lifecycle, with Articles 19 and
26(6) requiring those logs be kept at least six months. High-risk
obligations have been in force since **2 August 2026**.

Those articles are still real and still the reason the flight recorder is
built the way it is. What was false was the implied conclusion. This tool
does not make anyone compliant — no software can — and attaching a price to
that paragraph made it read like it might.

## What is not for sale

Nothing is for sale. The list is kept because every item on it is a sentence
somebody will eventually be tempted to write.

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
