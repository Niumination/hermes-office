# Policy as Floor Plan

Every agent governance product expresses policy as YAML nobody reads. Hermes
Office already draws a building — so the drawing is made authoritative.

```
room                        = trust zone      (which tools and models are reachable)
room budget                 = spend envelope  (a small room cannot burn much)
door                        = policy gate     (some transitions need a human)
moving an agent into a room = granting scope
```

The payoff is auditability by a non-engineer. *"Why was the agent allowed to
run kubectl?"* becomes *"because someone put it in the server room — here is
who did that, and when."*

## Deny by default

An unknown room, an unassigned agent, or a tool matching nothing all land in
the **default room**, which is the least privileged zone. Policy that fails
open is not policy.

## The default floor plan

| Room | Trust | Tools | Max model | Budget/hr | Gates |
|---|---|---|---|---|---|
| `lobby` | untrusted | `web_search`, `read_file`, `fetch`, `llm:*` | cheap | $0.25 | — |
| `main-office` | standard | `*` minus shell/deploy/infra | premium | $2.00 | — |
| `meeting-room` | standard | same as main office | premium | $1.00 | — |
| `ceo-office` | standard | `*` minus shell/deploy/infra | premium | $10.00 | entry |
| `mac-studio` | privileged | `*` minus terraform | premium | $3.00 | entry, `deploy` `bash` |
| `server-room` | privileged | `*` | premium | $5.00 | entry, `deploy` `kubectl` `terraform` `psql` `bash` |
| `kitchen`, `nap-room` | idle | none | — | $0 | — |

Override with `OFFICE_POLICY_FILE=/path/to/floorplan.json`. An unreadable or
malformed file logs a warning and falls back to the built-in default — it never
boots with no policy at all.

## `POST /policy/check`

The unified gate: room policy first (*is this permitted here?*), then spend
(*can we afford it?*). Supersedes `/budget/check`, which remains for callers
that only care about money.

```bash
curl -X POST http://127.0.0.1:7333/policy/check \
  -H "Authorization: Bearer $OFFICE_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"deployer","tool":"kubectl","model":"claude-sonnet-4-5"}'
```

```json
{
  "agent": "deployer", "room": "lobby", "roomLabel": "Lobby", "trust": "untrusted",
  "allow": false, "action": "deny",
  "reason": "kubectl is outside the scope of Lobby",
  "hint": "allowed in: Server Room (with sign-off), Mac Studio (with sign-off)"
}
```

Denials are **actionable**: `hint` names the rooms where the tool would work,
and whether sign-off is needed there. An operator reading this knows the next
move without opening a config file.

### Evaluation order

1. **Idle room** — budget `0` short-circuits: "agents here are idle".
2. **Tool permission** — deny list beats allow list.
3. **Model tier ceiling** — `cheap` < `standard` < `premium`.
4. **Human gate** — gated tools open an approval and return `await_approval`.
5. **Room spend envelope**.
6. **Agent and global spend**, delegated to `burnrate.js`.

The first failure wins, and the strictest spend scope governs.

### Actions

| `action` | `allow` | Meaning |
|---|---|---|
| `allow` | ✅ | permitted here |
| `restrict` | ❌ | model too expensive for this room; see `suggestModel` |
| `await_approval` | ❌ | a human must decide; see `approvalId` |
| `deny` | ❌ | not permitted here; see `hint` |
| `advise` / `throttle` | varies | passed through from the burn-rate ladder |

## Granting scope

```bash
curl -X POST http://127.0.0.1:7333/agents/deployer/room \
  -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"room":"server-room"}'
```

**Owner only** — moving an agent *is* granting it scope. The move is recorded
with who performed it and broadcast as `agent_moved`.

- `200` — moved.
- `202` — the room requires entry sign-off; an approval was opened and the
  agent has **not** moved. The response carries `approvalId`.
- `400` — unknown room.

## The approval queue

| | |
|---|---|
| `GET /approvals` | pending requests — any authenticated identity |
| `GET /approvals/:id` | one request, so an agent can poll its own |
| `POST /approvals/:id` | `{"approve": true\|false}` — **owner only** |

Reading the queue is not privileged; deciding it is. A guest can see that
something is waiting but cannot resolve it.

Approvals expire after `OFFICE_APPROVAL_TTL_MIN` (default 5). Expired and
resolved entries are swept hourly, so the map cannot grow without bound.
Resolving twice returns `409`.

### Two independent gates

Entering a privileged room and using a dangerous tool inside it are separate
grants. An agent approved into the server room still needs sign-off for
`deploy`. Approval tokens are bound to `(agent, tool)` and cannot be replayed
for a different agent or a different tool — there is a test pinning both.

## Governance events

`agent_moved`, `approval_requested` and `approval_resolved` are broadcast so
the office reacts live. All three are **internal-only**: a bridge that POSTs
one to `/event` gets `400 … is internal-only`. A compromised bridge must not
be able to move itself into the server room or self-approve.

## The UI

`ApprovalGate.tsx` renders the pending queue as a panel that visibly blocks the
floor, with a knocking-door glow. Owners get approve/deny buttons; everyone
else sees "owner decision required". Room state, occupants and spend come from
`GET /policy`.

`prefers-reduced-motion` disables the animation.

## Relationship to burn rate

`burnrate.js` answers *can we afford this?* across agent and global scopes.
This module answers *is this permitted here?* and adds a third spend scope: the
room. `/policy/check` composes both; `/burn` and `/budget/check` remain
available for money-only callers.
