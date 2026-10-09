# Hermes Office

**English** · [Bahasa Indonesia](README.id.md)

**Agent fleet governance you can show an auditor — and the person who signs
the invoice.**

The floor plan **is** the policy. Every room carries its own trust level,
tool list, model-tier ceiling, hourly budget and approval rule. Moving an
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

- **96% of enterprises exceed their AI cost projections. Only 44% have any
  guardrails at all.** (IDC, Dec 2025)
- **No major agent framework ships a native dollar cap.** You can cap tokens,
  you can rate-limit — you cannot say "stop at $50". OWASP names this
  **LLM10 — Denial of Wallet**.
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
| **Floor plan as policy** | Rooms carry rules. Lobby $0.25/hr, meeting room $1 and refuses `bash`/`deploy`/`kubectl`, server room $5 and requires human approval, CEO office $10. A policy you can point at on a screen is a policy people read. |
| **A dollar cap that actually stops** | `normal → warm → hot → critical → tripped`, with actions `allow / advise / restrict / throttle / deny`. It steers before it halts, following Microsoft's TokenOps finding that steering cut spend per task ~78% while hard stops wrecked task completion. |
| **Tamper-evident flight recorder** | Every decision SHA-256 chained, append-only. 0.020 ms per record; 100,000 records verify in 0.7 s and occupy 31.3 MB. |
| **External anchoring** | A chain alone cannot detect tail truncation. Head hashes are published to outside sinks, so deleting the last hundred records becomes visible. Strength is reported as `none`/`local`/`remote` — never claimed stronger than it is. |
| **Time Machine** | Replay any range from the chain. Agents have **rooms, not coordinates**: if the chain did not record it, the replay will not invent it. |
| **Kiosk mode** | A wall display that **downgrades its own privileges** — no dollar figures even for the owner, unless explicitly asked for per-URL. |
| **Standup** | A ranked morning read, deterministic, with no LLM call. A quiet night produces one line. |
| **Compliance dossier** | The artifact an assessor reads, carrying its own verification verdict inside it. |

And yes — it looks good. A donghua-styled 3D isometric office, 12 rooms, 282
sprites. That is not decoration: the entire reason the floor plan is the
policy is so a non-technical person can read your fleet's posture from across
the room.

## What it does NOT do

This list matters as much as the one above, and it is deliberately up front.

- **It never reads your prompt content.** Not on any path. What it processes
  is governance metadata: who, which tool, which room, what it cost, allowed
  or not.
- **It does not compete with the vendor's Agent View.** Claude Code has
  shipped a native "what's running" view since v2.1.139. The vendor will
  always win there. This product is about **what is allowed to run, and what
  you can prove afterwards.**
- **It is not sold per seat.** A governance tool that charges you for
  inviting your compliance officer to look is a broken governance tool.
- **It is not multi-tenant SaaS.** It runs on your infrastructure, on your
  data, in a SQLite file you can copy.
- **Tamper-evident, not tamper-proof.** That exact phrase is rendered in the
  UI. A hash chain makes changes detectable; it does not make them
  impossible. Anyone selling you the second thing is lying.

## An honest comparison

The LLM observability market is crowded, and most of it is far bigger than
this.

| | Focus | 2026 pricing |
|---|---|---|
| Langfuse (35.4k★) | Tracing, eval, prompt mgmt | $29 / $199 / **$2,499** Enterprise |
| LangSmith | Tracing + eval | **$39/seat** + $0.50–2.50 per 1k traces |
| Braintrust | Eval; raised $80M @ $800M | Free → $249 |
| Laminar | Tracing | $30 / $150, unlimited seats |
| **Hermes Office** | **Guardrails + evidence**, not tracing | **$0 / $39 / $299 / $2,000+** |

If what you need is to compare two prompts, use Langfuse. This tool answers a
different question: *what is my fleet allowed to do without me, what does it
cost before it stops, and can I prove it six months from now.*

See [`docs/PRICING.md`](docs/PRICING.md) for the full packaging and the
argument behind the numbers.

## Architecture at a glance

```
Agents / bridges ──OTLP──┐
Hermes Cloud ────────────┼──► office-server ──► Browser (React isometric office)
Hermes Mac ──────────────┘    Express 4 + ws        /kiosk   → wall display
                                    │               /standup → morning read
                            policy ─┤               /replay  → time machine
                         burn-rate ─┤               /dossier → evidence
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
| Backend tests | **305** |
| Frontend tests | **129** |
| Machine-verified doc claims | **88** (`scripts/check-docs.py`) |
| Bundle | 216 kB JS · 43.7 kB CSS |
| CI | 4 jobs, canonical source in `ci/workflow.yml` |

`check-docs.py` executes the documentation against the repo — route counts,
line counts, asset counts, and guard phrases like *"never reads prompt
content"*. A doc that lies about the code fails CI. It exists because these
documents are part of what is being sold.

That includes this README, in both languages: the checker enforces that the
English and Indonesian versions quote the same prices, the same test counts,
and still carry the same promises. A translation is a second place for a
claim to rot.

## Documentation

| File | Contents |
|---|---|
| [`PRICING.md`](docs/PRICING.md) | Packaging, and the argument for the price |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modules, routes, decisions |
| [`PRD.md`](docs/PRD.md) | Product pillars, non-goals, roadmap |
| [`SECURITY.md`](docs/SECURITY.md) | Token model, auto-guest, redaction pipeline |
| [`POLICY.md`](docs/POLICY.md) | Floor plan as policy |
| [`BURN-RATE.md`](docs/BURN-RATE.md) | States, actions, budgets |
| [`FLIGHT-RECORDER.md`](docs/FLIGHT-RECORDER.md) | Hash chain, anchoring, verification |
| [`REPLAY.md`](docs/REPLAY.md) · [`KIOSK.md`](docs/KIOSK.md) · [`STANDUP.md`](docs/STANDUP.md) | The three derived surfaces |
| [`OTLP.md`](docs/OTLP.md) · [`EVENTS.md`](docs/EVENTS.md) | Ingest contracts |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Running it for real |
| [`CHANGELOG-v2.md`](CHANGELOG-v2.md) | Every phase, including the ones that failed |

Most documents are written in Indonesian; this README and `PRICING.md` are
available in both.

## Origin

Forked from [Claude-Office](https://github.com/W17ant/Claude-Office) (MIT),
which contributed the isometric office and its art. Every governance
layer — policy, burn-rate, flight recorder, anchoring, replay, kiosk,
standup — is new work in this fork. The original operational README is
archived at [`docs/LEGACY-README.md`](docs/LEGACY-README.md).

Licence: MIT for the core. See `PRICING.md` for the open-core boundary.
