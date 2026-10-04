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
