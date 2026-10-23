# Hermes Office

**English** · [Bahasa Indonesia](README.id.md)

[![CI](https://github.com/Niumination/hermes-office/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/Niumination/hermes-office/actions/workflows/ci.yml)

**Agent fleet governance you can show an auditor.**

The floor plan **is** the policy. Every room carries its own tool list and
approval rule, and a room with no work in it is marked `idle`. Moving an
agent between rooms changes what it is allowed to do — and every one of those
moves is written into a verifiable hash chain.

```bash
npm ci && (cd frontend && npm ci && npm run build)
bash scripts/demo.sh
```

One command boots a throwaway office, seeds 90 seconds of a story anyone will
recognise from their own logs, and prints the tour.

---

## The problem it buys you out of

Three numbers and one date.

- **The EU AI Act's high-risk obligations took effect 2 August 2026.**
  Article 12(1) requires automatic logging, Articles 19 and 26(6) require
  those logs be retained for at least six months, Article 14 requires human
  oversight. Article 99(4) sets the penalty: **€15 million or 3% of global
  turnover.**

The first two are about money leaking. The third is about being able to prove
what happened, months later, to somebody who does not trust you. Hermes
Office was built for all three at once, because in the field they are the
same event: an agent did something expensive, and nobody can say for certain
why it was allowed to.

## What you actually get

| | |
|---|---|
| **Floor plan as policy** | Rooms carry rules. `mac/sites` refuses `bash`/`deploy`/`kubectl`; `lightvela/infra` requires human approval to enter; `mac/vault` is `idle` and refuses everything. A policy you can point at. |
| **Tamper-evident flight recorder** | Every decision SHA-256 chained, append-only. 0.020 ms per record; 100,000 records verify in 0.7 s and occupy 31.3 MB. |
| **External anchoring** | A chain alone cannot detect tail truncation. Head hashes are published to outside sinks, so deleting the last hundred records becomes visible. Strength is reported as `none`/`local`/`remote` — never claimed stronger than it is. |
| **Time Machine** | Replay any range from the chain. Agents have **rooms, not coordinates**: if the chain did not record it, the replay will not invent it. |
| **Standup** | A ranked morning read, deterministic, with no LLM call. A quiet night produces one line. |
| **Compliance dossier** | The artifact an assessor reads, carrying its own verification verdict inside it. |

And yes — it looks good. A donghua-styled 3D isometric office, 12 rooms, 132
sprites. That is not decoration: the entire reason the floor plan is the
policy is so a non-technical person can read your fleet's posture from across
the room.

## What it does NOT do

This list matters as much as the one above, and it is deliberately up front.

- **It never reads your prompt content.** Not on any path. What it processes
  is governance metadata: who, which tool, which room, allowed or not.
- **It does not compete with the vendor's Agent View.** Claude Code has
  shipped a native "what's running" view since v2.1.139. The vendor will
  always win there. This product is about **what is allowed to run, and what
  you can prove afterwards.**
- **It is not multi-tenant SaaS.** It runs on your infrastructure, on your
  data, in a SQLite file you can copy.
- **Tamper-evident, not tamper-proof.** That exact phrase is rendered in the
  UI. A hash chain makes changes detectable; it does not make them
  impossible. Anyone selling you the second thing is lying.

## An honest comparison

The LLM observability market is crowded, and most of it is far bigger than
this. A table of competitor price tiers used to sit here; it was removed on
2026-10-20 along with everything else in this repository denominated in money.

If what you need is to compare two prompts, use Langfuse. This tool answers a
different question: *what is my fleet allowed to do without me, and can I
prove it six months from now.*

## Architecture at a glance

```
Agents / bridges ──OTLP──┐
Hermes Cloud ────────────┼──► office-server ──► Browser (React isometric office)
Hermes Mac ──────────────┘    Express 5 + ws        /auth    → the one door
                                    │               /standup → morning read
                            policy ─┤               /replay  → time machine
                                    │               /dossier → evidence
                     flight recorder┴─► SQLite (hash chain) ──► external anchors
```

ESM, Node ≥ 22. No external services, no mandatory account, no outbound calls
except the anchor webhooks you configure yourself.

Ingest is **OpenTelemetry GenAI semconv** — the `create_agent`,
`invoke_agent`, `execute_tool` and `retrieval` operations. That spec is still
*Development* and frameworks emit several attribute generations at once, so
the normalisation is real work and it is already done here.

## Quality bar

| | |
|---|---|
| Backend tests | **316** |
| Frontend tests | **244** |
| Machine-verified doc claims | **104** (`scripts/check-docs.py`) |
| Bundle | 295.3 kB JS · 44.0 kB CSS |
| CI | 4 jobs, canonical source in `ci/workflow.yml` |

`check-docs.py` executes the documentation against the repo — route counts,
line counts, asset counts, and guard phrases like *"never reads prompt
content"*. A doc that lies about the code fails CI. It exists because these
documents are part of what is being sold.

That includes this README, in both languages: the checker enforces that the
English and Indonesian versions quote the same prices, the same test counts,
and still carry the same promises. A translation is a second place for a
claim to rot.

## Verify it yourself

Nothing above asks to be taken on trust. Every number on this page is produced
by a command, and the command ships with the repository:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office
npm ci
npm run verify
```

**20 gates, about 4 minutes** on a 2-core machine. `npm run verify:fast`
skips the two rebuild gates and finishes in roughly a minute. Exit code 0
means every gate passed — and no gate prints a green line it did not earn,
because each verdict comes from that gate's own exit status, never from
grepping its output. An earlier version decided pass/fail by searching for the
word PASS, and cheerfully reported "lint clean" over two real errors.

| Gate | What it proves |
|---|---|
| handoff integrity | every file matches `MANIFEST.sha256` byte-for-byte; no extras |
| eslint | no lint errors in `server/` and `tests/` |
| frontend build | `tsc && vite build` — a type error fails here |
| backend tests | 316 tests |
| frontend tests | 170 tests |
| clean shutdown | the process exits with a live WebSocket attached |
| ledger under load | the hash chain survives 400 concurrent decisions: contiguous, no duplicates, verify ok |
| upstream assets | nothing was dropped silently; deliberate removals are recorded with their reasons |
| ci workflow | the committed workflow still matches its canonical source |
| dependency pins | no floating or URL versions |
| sbom | `sbom.cdx.json` rebuilt from the lockfiles and matched byte-for-byte |
| deployable | no hard-coded host or tailnet address in shipped code |
| dev server routes | the dev server boots and every backend route is proxied |
| room plates | 26 plates match their hashes **and** the house style rules |
| theme contrast | 26 token pairs measured in APCA Lc, computed from `oklch()` |
| doc claims | 94 documented claims executed against the repo |
| bridge agents | the cloud bridge attributes events to the agent that caused them, not to the machine |
| cast ids | every agent a bridge can emit is drawn as itself, and no two agents sharing a room are the same figure |
| sprites (+rebuild) | 32 cast sprites rebuild byte-for-byte, and the art is bound to the code that loads it |
| live site | the running site answers, serves the login shell without minting a session, refuses every data route to an anonymous caller, and serves this tree's bundle |

Three of those are worth singling out, because they are the ones that catch
what hashes cannot:

- **sprites (+rebuild)** does not compare files to recorded fingerprints. It
  re-runs the deterministic filter over `art/originals/` and demands the same
  bytes back. A drifted filter constant leaves every file on disk matching its
  own hash perfectly; only a rebuild notices.
- **doc claims** executes the prose. Route counts, line counts, asset counts,
  bundle size, and guard phrases like *"never reads prompt content"* are read
  out of the documents and checked against the repo. A document that lies
  about the code fails CI.
- **upstream assets** distinguishes an asset that fell out of a pipeline from
  one that was deleted on purpose — and fails in both directions, so a file
  restored from git history cannot quietly return.

If a gate is red on a clean clone, that is a defect and we want the report.
The repository is the evidence; this section is just the index to it.

## Documentation

| File | Contents |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modules, routes, decisions |
| [`PRD.md`](docs/PRD.md) | Product pillars, non-goals, roadmap |
| [`SECURITY.md`](docs/SECURITY.md) | Token model, single-principal auth, coordinated disclosure |
| [`SUPPORT.md`](docs/SUPPORT.md) | Which Node versions are supported, until when, and what support means here |
| [`POLICY.md`](docs/POLICY.md) | Floor plan as policy |
| [`FLIGHT-RECORDER.md`](docs/FLIGHT-RECORDER.md) | Hash chain, anchoring, verification |
| [`REPLAY.md`](docs/REPLAY.md) · [`STANDUP.md`](docs/STANDUP.md) | The two derived surfaces |
| [`OTLP.md`](docs/OTLP.md) · [`EVENTS.md`](docs/EVENTS.md) | Ingest contracts |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Running it for real |
| [`CHANGELOG-v2.md`](CHANGELOG-v2.md) | Every phase, including the ones that failed |

Most documents are written in Indonesian; this README is available in both.

## Origin

Forked from [Claude-Office](https://github.com/W17ant/Claude-Office) (MIT),
which contributed the isometric office and its art. Every governance
layer — policy, flight recorder, anchoring, replay,
standup — is new work in this fork. The original operational README is
archived at [`docs/LEGACY-README.md`](docs/LEGACY-README.md).

Licence: MIT. One owner, one token, nothing for sale.
