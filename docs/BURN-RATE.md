# Burn-Rate Governance

Spend is enforced **before** it happens, and rendered as room physics.

## Why enforcement, not another chart

Observability reports after the fact. By the time a dashboard shows a runaway
loop, the money is gone — a documented 2026 incident burned tens of thousands
over a single weekend before anyone looked at a graph.

- IDC (Dec 2025): **96% of enterprises exceed their AI cost projections**, and
  only **44% have any financial guardrail at all**.
- **No major agent framework ships a native dollar cap.**
- OWASP tracks this as **LLM10 — Unbounded Consumption / "Denial of Wallet"**.

So the budget has to be answerable in the request path, in microseconds, from
memory. That is `POST /budget/check`.

## Steering, not halting

Microsoft's TokenOps work found that run-level governance which *steers* —
downgrade the model, shorten the context, drop optional tool calls — cut spend
per task by **~78%** while raising task completion from **67% to 96%**. Hard
halting does the opposite: it "saves" money by failing the work, which simply
moves the cost to a human.

So the ladder degrades gradually and only denies at the very top:

| Ratio | State | Behaviour |
|---|---|---|
| < 50% | `normal` | allow |
| < 75% | `warm` | allow, suggest a cheaper model |
| < 90% | `hot` | allow cheap models, **refuse premium** |
| < 100% | `critical` | throttle to the cheapest viable tier |
| ≥ 100% | `tripped` | **deny**, with `retryAfterS` |

Scopes evaluated together — **the strictest one governs**: per-agent hourly,
global hourly, global daily.

## Configuration

```bash
OFFICE_BUDGET_HOURLY_USD=5.00          # all agents combined, per hour
OFFICE_BUDGET_DAILY_USD=40.00          # all agents combined, per day
OFFICE_BUDGET_AGENT_HOURLY_USD=1.00    # default per agent, per hour
OFFICE_BUDGET_PER_AGENT="researcher=2.50,planner=0.75"   # overrides
```

Unset or `0` means that scope is unlimited. With **no** budget configured the
feature is entirely inert: `decide()` always allows, and the UI physics layer
does not render at all.

## `POST /budget/check`

Ask before you spend. Auth: `bridge` or `owner`.

```bash
curl -X POST http://127.0.0.1:7333/budget/check \
  -H "Authorization: Bearer $OFFICE_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"researcher","model":"claude-opus-4","estimatedUsd":0.12}'
```

```json
{
  "state": "critical",
  "scope": "global",
  "subject": "office",
  "spentUsd": 0.468,
  "limitUsd": 0.5,
  "ratio": 0.936,
  "allow": false,
  "action": "throttle",
  "reason": "at 94% of global budget; premium models are blocked",
  "suggestModel": "claude-sonnet-4-5",
  "retryAfterS": 60
}
```

**Always `200`, even on deny.** This is a policy answer, not a transport
failure. Returning `429`/`402` would make well-behaved HTTP clients retry a
decision that is not going to change. Read `allow`.

`estimatedUsd` matters: the projected cost of *this* call is counted, so the
caller is stopped **at** the cap rather than one call past it.

### Actions

| `action` | `allow` | Meaning |
|---|---|---|
| `allow` | ✅ | within budget |
| `advise` | ✅ | proceed, but `suggestModel` is cheaper |
| `restrict` | ❌ | this specific model is too expensive right now |
| `throttle` | varies | cheapest tier only; premium refused |
| `deny` | ❌ | budget exhausted; see `retryAfterS` |

## `GET /burn`

Full snapshot — global and per-agent spend, limits, ratios, states, call and
token counts, plus the active policy. Any authenticated identity may read it,
including `guest`; this drives the UI.

## Accounting

Any event carrying `costUsd` feeds the tracker, so OTLP spans and Hermes bridge
events both count. Cost comes from `server/pricing.js` (see `docs/OTLP.md`) or
from provider-reported `gen_ai.usage.cost`.

Windows are fixed-resolution ring buffers — 60 buckets over an hour, 96 over a
day. **Memory is bounded regardless of traffic volume**; there is no list of
individual charges to grow. Lifetime totals never decay.

## `budget_state` events

Threshold crossings are broadcast as events, so the office reacts live without
polling. Only **transitions** are emitted, never every charge.

```json
{ "type":"budget_state", "scope":"agent", "subject":"burner",
  "from":"warm", "state":"tripped",
  "spentUsd":0.06, "limitUsd":0.06, "ratio":1, "source":"system" }
```

`budget_state` is **internal-only**. A bridge that tries to POST one to
`/event` gets `400 … is internal-only`. Budget state is server-authoritative:
a compromised bridge must not be able to fake "all clear" or trip someone
else's breaker.

## The physics layer

`frontend/src/components/BurnOverlay.tsx` polls `GET /burn` and renders state
as room temperature. A number in a dashboard is ignorable; a room on fire is
not.

| State | Visual |
|---|---|
| `normal` | nothing |
| `warm` | faint amber tint |
| `hot` | orange tint, slow pulse |
| `critical` | red tint, fast pulse, **flames rising from the floor** |
| `tripped` | blue wash, **sprinklers raining** |

A HUD in the corner shows spend against the hourly cap and expands on click to
per-agent detail. `prefers-reduced-motion` disables every animation and hides
the sprinklers, matching the contract the rest of the office already honours.

The overlay is self-contained and renders nothing when no budget is set.

## Model tiering

`isPremium()` and `suggestDowngrade()` use **regexes with negative lookahead**,
not substring matching. `"gpt-4o-mini".includes("gpt-4o")` is true — plain
substring matching would classify the cheap fallback models as premium and
block exactly the models the policy wants agents to retreat to, inverting the
whole mechanism. There is a test pinning this for 25 model ids.
