# Policy as Floor Plan

Every agent governance product expresses policy as YAML nobody reads. Hermes
Office already draws a building — so the drawing is made authoritative.

```
room                        = trust zone      (which tools and models are reachable)
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

The table below is generated from `DEFAULT_POLICY` in `server/policy.js`, which
is the only authority. Rooms are spelled `office/room` because `root` exists in
both offices. The default room is `belum-dipetakan`.

| Room | Label | Tools | Gates | State |
|---|---|---|---|---|
| `belum-dipetakan` | Belum dipetakan | allow: web_search read_file fetch llm:*<br>deny: — | — | — |
| `mac/root` | Root Ekosistem | allow: *<br>deny: deploy kubectl terraform | `bash` | — |
| `mac/apps` | Apps | allow: *<br>deny: deploy kubectl terraform | — | — |
| `mac/services` | Services | allow: *<br>deny: kubectl terraform | `deploy` `bash` | — |
| `mac/sites` | Sites | allow: *<br>deny: deploy kubectl terraform bash shell psql | — | — |
| `mac/desktop` | Desktop | allow: *<br>deny: deploy kubectl terraform bash shell psql | — | — |
| `mac/agents` | Agents | allow: *<br>deny: deploy kubectl terraform | `bash` | — |
| `mac/labs` | Labs | allow: *<br>deny: deploy kubectl terraform bash shell psql | — | — |
| `mac/dinas` | Dinas | allow: *<br>deny: deploy kubectl terraform bash shell psql | entry | — |
| `mac/brain` | Brain | allow: read_file write_file web_search fetch llm:*<br>deny: — | — | — |
| `mac/skills` | Skills | allow: read_file write_file web_search llm:*<br>deny: — | — | — |
| `mac/tools` | Tools | allow: —<br>deny: — | — | **idle** |
| `mac/vault` | Vault | allow: —<br>deny: — | entry | **idle** |
| `lightvela/root` | Root Ekosistem | allow: *<br>deny: kubectl terraform | `deploy` `bash` | — |
| `lightvela/infra` | Infrastruktur & Monitoring | allow: *<br>deny: — | entry, `deploy` `kubectl` `terraform` `psql` `bash` | — |
| `lightvela/content` | Content Studio | allow: *<br>deny: deploy kubectl terraform bash shell psql | — | — |

A room marked **idle** refuses everything and says so in those words. Until
2026-10-20 the same thing was expressed as `budgetHourlyUsd: 0`, which made a
closed room read like a cheap one. A switch that means "closed" must say
"closed".

Override with `OFFICE_POLICY_FILE=/path/to/floorplan.json`. An unreadable or
malformed file logs a warning and falls back to the built-in default — it never
boots with no policy at all.

## `POST /policy/check`

The gate: is this tool permitted in this room, and does it need a human to
say yes first? Those are the only two questions left.

RETRACTED 2026-10-20: this route used to ask a third — *can we afford it?* —
and `/budget/check` existed for callers that only cared about money. Neither
question had an answer worth acting on: nothing in production ever called
either route, so no ceiling ever refused anything.

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

1. **Idle room** — a room flagged `idle` short-circuits: "agents parked here
   are idle". Nothing runs until the owner gives the room work.
2. **Tool permission** — deny list beats allow list.
3. **Human gate** — gated tools open an approval and return `await_approval`.

The first failure wins.

RETRACTED 2026-10-20: a model-tier ceiling, a room spend envelope and an
agent/global spend ladder used to sit in this list. They are gone with the
rest of the cost layer.

### Actions

| `action` | `allow` | Meaning |
|---|---|---|
| `allow` | ✅ | permitted here |
| `await_approval` | ❌ | a human must decide; see `approvalId` |
| `deny` | ❌ | not permitted here; see `hint` |

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

Reading the queue and deciding it are the same standing. The owner sees that
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

`sect/Writ.tsx` (Titah) renders the pending queue as a panel that visibly blocks the
floor, with a knocking-door glow. Owners get approve/deny buttons; everyone
else sees "owner decision required". Room state and occupants come from
`GET /policy`.

`prefers-reduced-motion` disables the animation.

## Retracted: the spend layer

Until 2026-10-20 this document also described `burnrate.js`, which answered
*can we afford this?* across agent, global and room scopes, and the routes
`/burn` and `/budget/check` that exposed it.

All of it is gone. It was not a brake: `burn.record()` was never called in
production, no bridge ever posted a cost, and the OTLP path that could have
estimated one was never enabled. A mechanism that has never refused anything
is not a control, and leaving it in the policy document described a building
that does not exist.

