# Deployment & Operations — Hermes Office

> **Status aktual (Okt 2026):** DEPLOYED di `~/niumination/hermes-office` — systemd user unit `hermes-office` aktif di port 7333; akses publik via **Cloudflare Tunnel** (`https://dash.abstract.biz.id`, unit `cloudflared.service`); cloud bridge aktif di `~/.hermes/hooks/office-bridge`. Lihat §11.

## 1. Prasyarat Server

- Ubuntu 24.04 (server LightVela saat ini) — sudah ✓
- Node.js ≥ 20 — cek: `node -v` (install via nvm/nodesource bila belum)
- SQLite — bundled via better-sqlite3
- systemd user session aktif (sudah — dipakai hermes-gateway) ✓
- Akses reverse proxy (subdomain atau path) — via dashboard LightVela / Cloudflare

## 2. Struktur Deploy

```
/home/agentuser/niumination/hermes-office/        # app (git clone dari Niumination/hermes-office)
├── server/ frontend/ scripts/ ...
├── frontend/dist/                   # hasil vite build (gitignored)
├── data/office.db                    # SQLite (gitignored, backup harian)
└── .env.office                       # secret (0600, gitignored)
```

## 3. Langkah Deploy Pertama

```bash
# 1. Clone
git clone git@github.com:Niumination/hermes-office.git ~/niumination/hermes-office
cd ~/niumination/hermes-office

# 2. Secret
cp .env.office.example .env.office
# isi: OFFICE_CLOUD_TOKEN, OFFICE_MAC_TOKEN, OFFICE_OWNER_TOKEN
# generate: openssl rand -hex 24 (satu per token)
chmod 600 .env.office

# 3. Build frontend
#    Skrip build ada di frontend/, BUKAN di akar repo — akar hanya punya
#    start/dev/test/lint/sbom/verify/verify:fast. `npm run build` di akar gagal
#    dengan "Missing script: build".
npm ci                                 # server deps (better-sqlite3, addon native)
cd frontend && npm ci && npm run build && cd ..

# 4. Install service
bash scripts/install-service.sh
# → membuat ~/.config/systemd/user/hermes-office.service
# → systemctl --user enable --now hermes-office

# 5. Verify
curl -s http://127.0.0.1:7333/health | jq
```

## 4. systemd Unit (dibuat oleh install-service.sh)

```ini
[Unit]
Description=Hermes Office — pixel office for Niumination agents
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/hermes-office
EnvironmentFile=%h/hermes-office/.env.office
ExecStart=%h/hermes-office/node_modules/.bin/node server/index.js
Restart=always
RestartSec=5
# Hardening ringan
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
```

> ⚠️ Restart service ini TIDAK boleh dipanggil dari dalam proses Hermes
> (pola yang sama dengan hermes-gateway guard). Gunakan dashboard/terminal eksternal.

## 5. Akses Publik

**Opsi DIPAKAI: Cloudflare Tunnel** ✓

```bash
# Route: dash.abstract.biz.id → http://127.0.0.1:7333
# Config: ~/.cloudflared/config.yml, unit: cloudflared.service
```
- Tunnel outbound-only — tidak ada port publik yang dibuka di server (UFW deny incoming).
- WebSocket `/ws` otomatis ter-route (tunnel mendukung WS).
- WAJIB: origin tunnel masuk `ALLOWED_ORIGINS` di `.env.office` — tanpa ini asset browser ditolak 403 → halaman blank.
- TLS, DDoS protection, dan WAF dasar sudah include di edge Cloudflare (free tier).

> **Riwayat:** sebelumnya pakai Tailscale Funnel (`tailscale funnel --bg 7333`),
> dipensiunkan 12 Okt 2026 — domain jelek, HTTPS terbatas 3 port, tanpa WAF.

**Opsi alternatif: subdomain lain**
- Tambahkan DNS CNAME → tunnel (via `cloudflared tunnel route dns`)
- WAJIB: upgrade header `Connection` & `Upgrade: websocket` diteruskan (untuk /ws)

**Opsi B: path prefix** `lightvela.ai/office/`
- Rewrite `/office/(.*) → /$1` (frontend harus di-build dengan `base: '/office/'`)

**Opsi C: Tailscale-only** (tanpa expose publik)
- Akses `http://<office-host>:7333` dari device tailnet
- Set `ALLOWED_ORIGINS=http://<office-host>:7333`

## 6. Bridges Setup

### 6.1 Cloud bridge / hook (di server ini) — SUDAH TERPASANG ✓

```bash
cp -r bridges/hermes-cloud-hook ~/.hermes/hooks/office-bridge
# token & URL dibaca otomatis dari ~/.hermes/.env:
#   OFFICE_CLOUD_TOKEN=...   OFFICE_URL=http://127.0.0.1:7333/event
# aktif → perlu restart gateway dari DASHBOARD LightVela
```

### 6.2 Mac relay (di Mac)

```bash
# salin bridges/mac-relay/ ke Mac, lalu:
export OFFICE_URL=http://<office-host>:7333/event
export OFFICE_TOKEN=<OFFICE_MAC_TOKEN>
bash mac-relay.sh install   # → menaruh launchd plist + load
```

Relay membaca `~/.hermes/a2a_audit.jsonl` + heartbeat file. Log: `~/Library/Logs/office-relay.log`.

### 6.3 Denyut (di server ini, LightVela) — SUDAH TERPASANG ✓

Denyut menjaga agen tetap "online" di kantor agar presensinya tidak luruh
setelah 90 detik. Ini yang membuat balai berhenti kosong.

- Berkas: `bridges/hermes-emit/denyut.py` (disalin ke `~/.hermes/denyut.py`)
- Unit: `hermes-denyut.service` di `~/.config/systemd/user/` (user-service,
  bukan system unit — home `agentuser`)
- Jeda default 30 detik; `--interval` menolak > 45 detik (ambang 90,
  jadi jeda 30 memberi dua kesempatan gagal sebelum agen luring).
- Unit tidak menulis satu berkas pun: `ProtectSystem=strict`,
  `ReadWritePaths` kosong, `NoNewPrivileges` tidak berlaku di user unit
  (hapus `SystemCallFilter` agar tidak mati `216/GROUP`).

Menghentikan dan memulai:

```bash
systemctl --user stop hermes-denyut
systemctl --user start hermes-denyut
journalctl --user -u hermes-denyut -f
```

Percobaan satu-tembakan sebelum pasang unit (wajib hijau dulu):

```bash
python3 ~/.hermes/denyut.py --once
# diharapkan: terkirim 1, gagal 0
```

Agen yang baru berdenyut belum punya ruangan — pemilik menempatkannya
(secara terpisah):

```bash
curl -X POST -H "Authorization: Bearer $OFFICE_O⟪HERMES-CONTEXT-COMPRESSION: 54 of 105 chars omitted here by Hermes's context compressor. This is NOT part of the original tool call and must never be reproduced in new output — always write full, untruncated content.⟫

## 7. Update / Rollback

```bash
cd ~/niumination/hermes-office
git pull origin main                     # main adalah sumber kebenaran (lihat §7.1)
npm ci                                   # server deps — addon native, WAJIB node >= 22
cd frontend && npm ci && npm run build && cd ..
systemctl --user restart hermes-office   # dari terminal eksternal, bukan dari agent
```

> **Jebakan Node:** `better-sqlite3` adalah addon native. Kalau versi Node
> berganti antara `npm ci` dan restart, `dlopen` gagal dan ~100 test yang
> membuka ledger mati dengan pesan yang menuduh test-nya rusak. Jalankan
> `node -v` dulu; kalau berbeda: `npm rebuild better-sqlite3`.

Rollback: `git checkout <tag-sebelumnya> && npm ci && (cd frontend && npm ci && npm run build) && restart`.
DB migration: office-server menjalankan migrasi idempotent saat start; untuk rollback major, restore `data/office.db` dari backup.

### 7.1 main vs dev

`main` adalah sumber kebenaran dan branch yang dilayani. `dev` adalah tempat
pekerjaan berjalan; perbedaannya harus selalu fast-forward bersih
(`git rev-list --count main..dev` = N, `dev..main` = 0) sebelum digabung:

```bash
git checkout main
git merge --ff-only dev        # menolak kalau ada divergence
git push origin main
```

CI hanya berjalan `on: push: branches: [main]`, jadi langkah ini juga
satunya yang memicu pengujian lengkap sebuah rilis.

## 8. Backup

Cron harian (server):
```bash
0 4 * * * sqlite3 ~/niumination/hermes-office/data/office.db ".backup ~/backups/office-$(date +\%F).db" && find ~/backups -name 'office-*.db' -mtime +14 -delete
```

## 9. Monitoring

| Cek | Cara |
|---|---|
| Service hidup | `systemctl --user status hermes-office` |
| Health | `curl -s http://127.0.0.1:7333/health` |
| Log | `journalctl --user -u hermes-office -f` |
| WS clients | field `ws_clients` di /health |
| Event throughput | field `events_per_min` di /health |

Alert opsional: cron check /health → Telegram topic #5 jika down 3x berturut.

## 9.1 Cron Telegram terkait ekosistem (status 2026-10-04)

Cron Hermes yang mengirim ke Telegram (infra office-bridge) diarahkan ke topik **#55 Cron/Automate** (LightVela-Group):

| Cron | Interval | Catatan |
|---|---|---|
| Peringatan Dini Gayo (cec9edba7395) | 3 jam (diperlambat dari 30 mnt) | prakiraan agroclimate |
| Status Mitigasi Bencana (081c15c134a9) | 6 jam (dari 3 jam) | status mitigasi agroclimate |

Thread ID topik juga dipakai relay laporan warga agroclimate (`POST /api/reports` → topik #55).

## 10. Troubleshooting

| Gejala | Kemungkinan | Perbaikan |
|---|---|---|
| /health 404 dari luar | proxy belum pasang / WS headers | cek upgrade headers |
| Karakter tidak bergerak | bridge mati / token salah | `tail` log bridge; test POST manual |
| Mac tidak pernah `idle` | relay launchd mati | `launchctl list | grep office` |
| Chat tidak menjawab | Hermes API down / token | cek `HERMES_API` reachable dari office-server |
| OOM / memory naik | ring buffer bocor | cek retention job; restart |

### 10.1 Gotcha presence & auth (era dual-space)

- **Karakter mac selalu tampil `away` di browser** — dua akar masalah:
  1. *AgentsPanel default away*: WS tidak me-replay history, jadi presence baru
     diketahui setelah heartbeat berikutnya. Frontend kini **seed presence dari
     `GET /presence` saat mount**.
  2. *`agent_status.agent` bisa objek atau string*: bila bridge mengirim objek
     `{name, id}`, Map presence memakai `[object Object]` sebagai key → tidak
     pernah match. Fork ini sempat punya bug kebalikannya — ia **mensyaratkan**
     string sehingga membuang heartbeat bentuk-objek diam-diam, termasuk setiap
     `agent_spawned` yang `agent`-nya objek menurut skema. Keduanya diperbaiki
     dengan menormalkan ke `id ?? name`.
- **Satu pemilik, satu pintu**: `GET /` menyajikan cangkang halaman masuk dan
  **tidak** mencetak sesi. Satu-satunya pencetak sesi adalah `POST /auth/session`
  dengan `Authorization: Bearer <OFFICE_OWNER_TOKEN>`, yang membalas cookie
  `office_session` (HttpOnly, SameSite=Lax, 12 jam). Rute data mana pun tanpa
  sesi menjawab **401**.
- **Mode tamu sudah dicabut** (Okt 2026). Dulu `GET /` dan `GET /kiosk`
  menerbitkan sesi tamu read-only, sehingga karena funnel bersifat publik,
  redaksi per-field adalah satu-satunya batas. Token tamu, rute `/kiosk`, dan
  seluruh pipeline redaksi sudah dihapus — jangan menambahkannya kembali untuk
  "memudahkan demo". Lihat docs/SECURITY.md §3.

## 11. Status Deployment Aktual (Okt 2026)

| Komponen | Status |
|---|---|
| Service `hermes-office` | aktif (user systemd), port 7333, env `.env.office` (0600) |
| Akses publik | Cloudflare Tunnel `https://dash.abstract.biz.id` (12 Okt 2026) |
| Unit tunnel | `~/.config/systemd/user/cloudflared.service` (enabled, auto-restart) |
| `ALLOWED_ORIGINS` | `https://dash.abstract.biz.id` + 127.0.0.1:7333 |
| Cloud hook | `~/.hermes/hooks/office-bridge` AKTIF — token `OFFICE_CLOUD_TOKEN` di `~/.hermes/.env` |
| Mac relay | siap, belum ter-install (menunggu Mac online) |
| Health | `curl -s http://127.0.0.1:7333/health` |

> **Riwayat:** sebelum 12 Okt 2026 pakai Tailscale Funnel
> (`https://vm-6-34-ubuntu.tailec8707.ts.net`, unit `tailscale-funnel.service`).
> Funnel publik sudah dimatikan; UFW deny incoming, semua inbound lewat tunnel.

Catatan gotcha yang pernah terjadi:
- Blank page saat expose baru aktif → penyebab: origin belum di `ALLOWED_ORIGINS` → 403 pada asset JS.
- Hook diam (tidak kirim event) → penyebab: `OFFICE_CLOUD_TOKEN` belum ada di `~/.hermes/.env`.


---

## Penambatan ledger (Fase 11)

Aktif secara default dengan berkas lokal saja. Itu **lemah** — berkasnya ada
di disk yang sama dengan ledger. Untuk deployment yang akan diaudit, pasang
minimal satu webhook independen:

```bash
OFFICE_ANCHOR_WEBHOOKS=https://audit.contoh.com/v1/anchor,https://hooks.slack.com/services/XXX
OFFICE_ANCHOR_INTERVAL_MS=900000     # 15 menit
```

Setiap sink menerima `POST` berisi `{seq, hash, records, ts, note}`. Hanya
balasan **2xx** yang dihitung sebagai tertambat; 404 dicatat sebagai gagal.
URL diredaksi (kredensial dan query string dibuang) sebelum muncul di
`GET /ledger/anchors` atau di log — token webhook hidup di query string.

**Tambatkan secara manual sebelum mengekspor dosier:**

```bash
curl -X POST -H "Authorization: Bearer $OWNER" \
     -H 'content-type: application/json' \
     -d '{"note":"pra-ekspor Q4"}' \
     https://office.example.com/ledger/anchor
```

Balasan **207** berarti sebagian sink gagal — Anda tertambat, tapi tidak di
semua tempat yang Anda minta. Jangan perlakukan 207 sebagai sukses.

`GET /ledger/verify` kini memuat `anchors` dan satu bidang ringkas
`trustworthy` = konsisten-internal **dan** konsisten-tambatan. Pantau bidang
itu, bukan `ok` — `ok` tetap `true` pada rantai yang dipotong.

---

## 12. Meluncurkan UI Perguruan (patch 017)

Patch 017 mengganti seluruh frontend: 38 berkas dihapus, satu stylesheet
tersisa, dan dua permukaan tata kelola (`Segel` ledger, `Titah` persetujuan)
dipulihkan. Bagian ini adalah urutan penerapannya di server yang sudah hidup.

### 12.1 Sebelum menyentuh server

```bash
# Di klon kerja, bukan di server. Buktikan dulu bahwa bundel ini sehat.
npm ci && (cd frontend && npm ci)
npm run verify          # 16 gerbang, ±240 dtk
```

Jangan lanjut bila belum 16/16. Khususnya gerbang **14 (theme contrast)** dan
**15 (doc claims)** — keduanya menyentuh berkas yang diubah patch ini.

### 12.2 Urutan di server

```bash
cd ~/hermes-office
git fetch && git checkout dev && git pull

# Frontend DULU, service belakangan. Bundel baru harus sudah ada di disk
# sebelum proses lama dimatikan, supaya jendela "halaman blank" nol.
cd frontend && npm ci && npm run build && cd ..

systemctl --user restart hermes-office
systemctl --user status hermes-office --no-pager
```

> **Skrip `build` ada di `frontend/`, bukan di akar.** `npm run build` di akar
> gagal dengan `Missing script: build`. Akar hanya punya
> `start/dev/test/lint/sbom/verify/verify:fast`.

### 12.3 Verifikasi setelah restart — lima langkah, bukan satu

Memuat halaman lalu melihat kantor tampil **bukan** bukti. REST dan WebSocket
gagal secara terpisah; UI tetap menggambar dengan socket mati.

```bash
H=https://<host-anda>

curl -sS -o /dev/null -w '%{http_code}\n' $H/                 # harap 200
curl -sS -o /dev/null -w '%{http_code}\n' $H/policy           # harap 401 (tanpa sesi)
curl -sS -c /tmp/c.txt -o /dev/null -w '%{http_code}\n' \\
  -X POST -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" $H/auth/session   # mencetak sesi
curl -sS -b /tmp/c.txt -o /dev/null -w '%{http_code}\n' $H/policy  # harap 200, teredaksi

# Yang paling sering terlewat: upgrade WebSocket DENGAN header Origin.
curl -sS -o /dev/null -w '%{http_code}\n' -b /tmp/c.txt \
  -H "Origin: $H" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  $H/ws                                                        # harap 101
```

Di UI, tiga hal harus benar sekaligus:

- bilah atas berbunyi **`terhubung · v<versi>`**, bukan `luring`;
- cincin Tenaga menampilkan salah satu dari tiga keadaan yang sah
  (`—` bila belum terukur / `$x · tanpa pagu` / `$x / $y`) — bukan tiga setrip;
- lencana **Segel** menampilkan jumlah catatan bila Anda pemilik, dan **tidak
  muncul sama sekali** bila probe-nya ditolak. Segel yang tampil tapi mati
  justru mengiklankan log audit yang tak bisa dibaca pemanggilnya.

### 12.4 `ALLOWED_ORIGINS` — jebakan yang sudah tiga kali memakan korban

Ini penyebab pemadaman paling sering di repo ini, dan selalu menyamar sebagai
masalah lain.

**Gejalanya:** halaman memuat, kantor tergambar, statusnya menempel di
`luring`, dan tidak ada error di log server. Tampak seperti socket rewel.
Sebenarnya REST lolos (same-origin lewat proxy, tanpa header `Origin` yang
bermasalah) sementara upgrade WebSocket ditolak `403` oleh pemeriksaan origin.

**Aturannya:** setiap origin browser yang akan dipakai harus terdaftar —
satu per satu, termasuk port. Bukan wildcard, bukan hanya nama host.

```bash
# .env.office
ALLOWED_ORIGINS=https://vm-6-34-ubuntu.tailec8707.ts.net,https://office.lightvela.ai,http://127.0.0.1:7333,http://localhost:7333
```

Tambahkan juga, sesuai kebutuhan:

| situasi | origin yang WAJIB didaftarkan |
|---|---|
| dev lokal (`npm run dev`) | `http://localhost:3333`, `http://127.0.0.1:3333` |
| akses langsung ke server | `http://localhost:7333`, `http://127.0.0.1:7333` |
| Tailscale Funnel | `https://<host>.ts.net` |
| domain publik | `https://office.lightvela.ai` |
| preview sandbox/cloud | `https://<port>-<id>.e2b.app` (host baru = entri baru) |

> **Port dev adalah 3333, bukan 5173.** Default bawaan di `server/config.js`
> dulu menyebut 5173 — port standar Vite yang repo ini tidak pernah pakai —
> sehingga setiap `npm run dev` tanpa `ALLOWED_ORIGINS` eksplisit berakhir
> dengan WS 403. Defaultnya sudah diperbaiki, tetapi di produksi Anda tetap
> harus mendaftarkan origin sendiri.

**Cara membacanya saat mendiagnosis:**

| kode | artinya |
|---|---|
| `403` | origin **ditolak** — tambahkan ke `ALLOWED_ORIGINS`, restart |
| `401` | origin **lolos**, sesinya yang belum ada — jalankan `POST /auth/session` dulu |
| `101` | sambungan naik, benar |

`curl` **tanpa** header `Origin` mengembalikan `101` meskipun konfigurasinya
salah. Pemeriksaan origin hanya berjalan bila headernya ada. Selalu sertakan
`-H "Origin: $H"` saat menguji, atau Anda akan menguji hal lain.

Setelah menyunting `.env.office`, **restart wajib** — nilainya dibaca sekali
saat boot:

```bash
systemctl --user restart hermes-office
```

### 12.5 Rollback

Patch ini hanya menyentuh `frontend/` dan `scripts/check-*.py`; skema basis
data, ledger, dan kontrak API tidak berubah. Jadi rollback aman dan tidak
perlu migrasi mundur:

```bash
cd ~/hermes-office
git checkout <commit-sebelum-017>
cd frontend && npm ci && npm run build && cd ..
systemctl --user restart hermes-office
```

Ledger tetap valid melintasi rollback — rantainya milik server, bukan UI.
Verifikasi dengan `curl -sS -b /tmp/c.txt $H/ledger/verify` sebagai pemilik:
`trustworthy: true` harus tetap `true`.
