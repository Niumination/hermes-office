# Hermes Office — Frontend

Isometric pixel-art visualisation of the Niumination agent fleet (cloud, mac,
boss, cron-runner, octo, guest-ghost). Ported from Claude-Office
(https://github.com/W17ANT/agent-office, MIT) with the Claude Code chat/AI
dependencies removed; chat now talks to the same-origin `office-server`.

## Develop

```bash
npm ci
npm run dev          # http://localhost:3333, proxies /ws + /chat to :3334
```

Open with query flags:

| Flag | Effect |
|---|---|
| `?mock=1` | In-app mock event feeder — office animates with no server |
| `?guest=1` | Guest mode: read-only, chat input hidden |

## Build

```bash
npm ci && npm run build      # emits dist/
```

`vite.config.ts` sets `base: './'`, so the build works both under a path prefix
(`example.com/office/`) and on a dedicated subdomain.

## Mock feeder

- In-app: `?mock=1` (drives the same handler pipeline as the WS client).
- Standalone: `node scripts/mock-feed.mjs --ws ws://host/ws` broadcasts
  `{channel:'event', data:{...}}` frames to a running office-server.

## Wiring

- `src/hermes/useOfficeSocket.ts` — same-origin WS client (`/ws`), `hello`
  handshake, exponential-backoff reconnect, tolerant of unknown channels/types.
- `src/hermes/eventMap.ts` — Hermes envelopes (docs/EVENTS.md) → office events.
- `src/hermes/HermesOfficeApp.tsx` — topbar + Agents/Chat/GitHub tabs.
- `src/hermes/OfficeStage.tsx` — the ported office renderer/animation loop.
- `src/hermes/wib.ts` — WIB (UTC+7) day/night cycle (06:00–18:00 day).
- `src/hermes/niu.ts` — Niu-mode palette + ID strings, persisted to `niu_mode`.
- `src/hermes/guest.ts` — guest-mode flag (`hermes_guest` / `?guest=1`).

## Attribution

Character, furniture, room and effect sprites under `public/` are reused from
[Claude-Office](https://github.com/W17ANT/agent-office) (MIT © W17ANT).
This frontend is MIT as well.
