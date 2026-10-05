# CHANGELOG — Hermes Office

## Unreleased

### DUAL-SPACE-DESIGN M-A — dua ruang tematik (Server Room ☁️ × Mac Studio 💻)

- **Ruang baru di peta kanvas tunggal**: `server-room` (Server Room ☁️) dan
  `mac-studio` (Mac Studio 💻), terhubung ke `main-office` via pintu yang bisa
  diklik (`frontend/src/rooms.ts`).
- **Pixel-art background baru**: `frontend/public/rooms/server-room-{day,night}.png`
  dan `mac-studio-{day,night}.png` (rak server + lampu LED, desk + monitor, rak
  drive repo).
- **Karakter berpindah ruangan**: event dirouting ke ruang asalnya — cron/cloud
  → Server Room, mac/a2a/git_push → Mac Studio; karakter cast berjalan ke
  ruang tsb (`frontend/src/hermes/eventMap.ts: targetRoomFor`, `OfficeStage`).
- **Mini feed per ruang**: panel kecil 5 event terakhir per ruangan
  (`frontend/src/components/RoomMiniFeed.tsx`).
- **Presence offline**: sprite grayscale + bubble "terakhir aktif HH:MM"
  (watchdog 90s, server kini menyimpan `lastSeenTs` dan menyediakan
  `GET /presence`), lampu indikator `service_status` per host.
- **Kontrak event**: type baru `service_status` (host/unit/kind/state/detail,
  whitelist) + field opsional `agent_status.metrics` (numeric clamp) dan
  `agent_status.lastSeenTs` — lihat `docs/EVENTS.md` §3, §8. Guest sanitization
  untuk `service_status.detail`.

### Fix presence & auth (ccd592b, bef4b6f, c8570bd)

- **`agent_status.agent` bisa objek atau string** — Map presence dulu pakai
  `[object Object]` sebagai key; kini key = `agent.id ?? agent.name ?? agent`
  (server + frontend OfficeStage parse sama).
- **AgentsPanel seed live presence dari `GET /presence` saat mount** — WS tidak
  me-replay history, jadi mac tidak lagi tampil `away` default setelah load.
- **Auto-guest session**: `GET /` otomatis membuat session guest read-only
  (cookie dari `OFFICE_GUEST_TOKEN`, kini wajib terisi di `.env.office`) —
  live site publik menampilkan presence nyata tanpa owner token.

### Mac: mac-relay terpasang + hardening A2A (Okt 2026)

- launchd `com.niumination.office-relay` aktif di Mac — tail audit log A2A +
  heartbeat 30s → mac `online: true` di `/presence`.
- Hardening A2A: `A2A_BEARER_TOKEN` dipindah ke `~/.hermes/.env` di Mac
  (terbukti survive cold boot), dihapus dari plist (plist 600 tanpa token,
  `.bak` dihapus), `chmod 600 a2a-token.txt`, `scripts/reload-gateway.sh` 8/8 test.
- Token relay server = token A2A Mac (`OFFICE_MAC_TOKEN` di `.env.office`) —
  satu token dua arah. Panduan: `bridges/mac-relay/MAC-PLAYBOOK-TONIGHT.md`.
