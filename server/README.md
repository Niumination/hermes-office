# Hermes Office — server

Node 22 + Express 4 + ws + better-sqlite3. One process: event hub, static host, chat proxy.
Contract: `docs/EVENTS.md` (source of truth) — mirrored in `tests/eventbus.test.js`.

## Run

```bash
cp .env.office.example .env.office   # fill tokens: openssl rand -hex 24
chmod 600 .env.office
npm install
npm start                            # http://127.0.0.1:7333
```

## Endpoints

| Route | Auth | Notes |
|---|---|---|
| `POST /event` | bridge (cloud/mac) | event contract, 16KB body, 120/min + burst 30/5s per token |
| `GET /health` | none | uptime, ws clients, buffer size |
| `GET /roster` | any token | static roster |
| `GET /chat`, `POST /chat` (+`/reply /seen /react /typing /completions`) | role-scoped | guests read-only; `@mac` → A2A peer (1 turn, 60s cooldown) |
| `GET /github/feed` | any token | git_push history; guest sees `[private]` |
| `GET /debug/events?limit=N` | owner | ring buffer peek |
| `WS /ws` | Bearer + origin allowlist | `hello` handshake, `event` frames, guest-filtered |

## Event pipeline

`POST /event` → auth (hash lookup) → rate limit → strict schema (unknown type = 400,
`office_chat` internal-only) → string clamp (500 / text 4000) → secret redaction
(sk-/ghp_/github_pat_/vik_/xox…/JWT/Bearer/key-value) → ring buffer (7d / 100k rows)
→ WS broadcast (guest connections receive `sanitizeForGuest()`-filtered frames).

## Tests

```bash
node --test tests/eventbus.test.js tests/integration.test.js
```
Integration test boots the real server on port 7391 with throwaway tokens + temp data dir.
