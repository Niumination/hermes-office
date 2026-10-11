# CHANGELOG — Hermes Office

## Unreleased

### Antarmuka perguruan menggantikan kantor isometrik (PR `arena/sect-ui-id`)

- **Frontend diganti, bukan ditumpuk.** 37 berkas `.ts/.tsx/.css` dihapus setelah
  dibuktikan tak terjangkau dari `main.tsx`. Stylesheet 5 → 1, berkas sumber
  57 → 35. Bundel turun: JS 298,9 → 259,0 kB, CSS 47,2 → 19,7 kB.
- **Seluruhnya Bahasa Indonesia.** Nol aksara Han di pohon aktif, termasuk
  komentar dan data pengumpan demo. Register persilatan: `server-room` menjadi
  **Bilik Rajah**, bukan "Ruang Server". Catatan sejarah (`CHANGELOG-v2.md`)
  sengaja dibiarkan — ia merekam apa yang memang terjadi saat itu.
- **Presence dilepas dari renderer.** Seeding `GET /presence`, polling 30 dtk,
  dan watchdog 90 dtk dulu hidup di dalam `hermes/OfficeStage.tsx`. Mengganti
  tampilan akan ikut membuangnya — situs live akan memuat dengan roster kosong
  dan agen mati tampak sama dengan agen yang tak pernah ada. Kini
  `hermes/usePresence.ts`, dengan 6 tes, dipakai antarmuka baru.
- **Roster jujur soal lokasi.** Presence memberi tahu siapa hidup, bukan di aula
  mana. Agen yang diketahui server tapi belum berbicara di socket muncul di
  roster dengan "terakhir aktif HH:MM", **tidak** digambar ke dalam aula —
  menempatkannya di aula yang tak diketahui adalah UI mengarang.
- **Dua breakpoint diperbaiki sebelum dikirim.** `@media` ditulis di atas
  `.sect-rail { display: flex }`; media query tidak menambah spesifisitas, jadi
  di bawah 860px rail dan kolom Babad saling menimpa. Ditemukan lewat tangkapan
  layar, bukan tes.
- **Tes frontend 170 → 90.** Penurunan jujur: tes pathfinding dan sprite mati
  bersama kantor isometrik yang diujinya. Backend tetap 305.


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
