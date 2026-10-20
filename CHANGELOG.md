# CHANGELOG — Hermes Office

## Unreleased

### 🔴 Perbaikan bypass autentikasi — 20 Oktober 2026

`GET /` menyerahkan cookie sesi **owner** kepada setiap pengunjung yang
belum terotentikasi, tanpa satu pun pemeriksaan. Karena kantor dipublikasikan
lewat terowongan Cloudflare, itu berarti siapa pun di internet bisa membuka
`dash.abstract.biz.id`, menerima cookie owner, lalu membaca `/ledger` dan
`/dossier` — diverifikasi dari luar jaringan dengan hasil **200**.

Komentar di kode menjanjikan allowlist (`OFFICE_TRUSTED_ORIGINS`) yang tidak
pernah ada implementasinya, dan menyatakan bahwa UFW plus terowongan membuat
setiap pemanggil "sudah ada di dalam". Terowongan berjalan di host kantor,
jadi pengunjung internet justru tiba sebagai `127.0.0.1`.

Dua penjaga yang seharusnya menangkap ini sudah ada sebelumnya dan **dibalik
pada commit yang sama**: tes `GET / mints no session for an anonymous
browser`, dan `check-live.sh` §2 yang berbunyi *"a cookie here would mean the
auto-session came back"*. Keduanya dipulihkan.

Perbaikan: auto-session kini dijaga `mayAutoSession()` yang menuntut alamat
peer ada di `OFFICE_AUTO_SESSION_CIDRS` **dan** permintaan tidak membawa
header penerusan apa pun. Bawaannya kosong, artinya fitur mati. Status
tercetak di baris boot sebagai `autoSession`.

Diperbaiki sekalian: predikat `trust proxy` dipanggil Express dengan
`(alamat, hop)`, bukan dengan `req`. Bentuk lamanya melempar `TypeError`
begitu ada kode yang membaca `req.ip` — 500 yang menunggu pembatas laju atau
log akses pertama yang menyentuhnya.

### Rotasi kredensial produksi — 19 Oktober 2026

Pesan commit `b4250ab` memuat potongan nilai `OFFICE_TOKEN` dan
`OFFICE_CLOUD_TOKEN` di badan pesannya. Pohon berkas bersih; kebocoran hanya
di riwayat pesan commit, dan karena repo ini publik, potongan itu permanen.

`OFFICE_OWNER_TOKEN`, `OFFICE_CLOUD_TOKEN`, dan `OFFICE_MAC_TOKEN` diputar.
Riwayat **tidak** ditulis ulang: force-push merusak setiap klon sementara
potongan lama tetap tertinggal di cache GitHub, sedangkan rotasi benar-benar
mematikan nilainya. Diverifikasi — ketiga token lama kini dijawab 401,
sementara `eventsBuffered` di `/health` terus naik, jadi rantai denyut tetap
mengalir dengan kredensial baru.

Aturan pencegahnya ditulis di `docs/SECURITY.md` §6, beserta runbook rotasi.

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
### Fase 14 — Pos Jaga tahap 2: aksi berpagar (14 Okt 2026)

**Bundle dari `hermes-sect#2.zip`** — 2 commit:
- `1b9d907` — fix race cooldown: slot dialokasikan sebelum `await`, bukan sesudah
- `c1fb932` — ledger tipe `desk_action` + output capture 2KB tail

**Implementasi P3-P6 (commit `f2ae3d4`):**
- **P3** — Serialisasi `actionsByDesk` ke `GET /desks` (id, label, confirm, cooldownMs, tanpa `run`)
- **P5** — Cabut pin `ubuntu-24.04`, gunakan `ubuntu-latest` di semua CI job
- **P6** — `summarize()` di `dossier.js` hitung `desk_action` di decisions + byAction

**Implementasi P4 — UI tombol (commit `b67873c`):**
- **Outposts.tsx** — ActionButton component, confirmation dialog, cooldown countdown
- **useOutposts.ts** — actions field di interface + normalise()
- **SectApp.tsx** — pass isOwner prop
- **CSS** — .action-btn, .action-btn:disabled, .cooldown-overlay styles
- **Test** — 5 test baru: owner sees actions, guest blind, confirmation renders, results display

**Desain kontrak** (`DESAIN-posjaga-tahap2.md`):
- `run` = array argv (no shell, no interpolation)
- `requireOwner` + `POST /policy/check` + ledger recording
- Cooldown default 60 detik per aksi per pos
- Response `{ok, exitCode, ms, ledgerSeq}` tanpa stdout/stderr mentah

**Verifikasi:**
- Backend: 375 tests (+17 sejak `4322cee`)
- Frontend: 132 tests (137 total termasuk 5 baru)
- 17/17 gates hijau
- Bundle roundtrip: byte-identik


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
