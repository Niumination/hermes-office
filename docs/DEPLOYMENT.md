# Deployment & Operations — Hermes Office

> **Status aktual (Okt 2026):** DEPLOYED di `~/niumination/hermes-office` — systemd user unit `hermes-office` aktif di port 7333; akses publik via **Tailscale Funnel** (`https://vm-6-34-ubuntu.tailec8707.ts.net`, unit `tailscale-funnel.service` enabled + linger); cloud bridge aktif di `~/.hermes/hooks/office-bridge`. Lihat §11.

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
├── dist/                             # hasil vite build (gitignored)
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
# isi: OFFICE_CLOUD_TOKEN, OFFICE_MAC_TOKEN, OFFICE_OWNER_TOKEN, (ops) OFFICE_GUEST_TOKEN
# generate: openssl rand -hex 24 (satu per token)
chmod 600 .env.office

# 3. Build frontend
npm ci
npm run build            # vite build → dist/

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

**Opsi DIPAKAI: Tailscale Funnel** ✓

```bash
sudo tailscale funnel --bg 7333
# → https://vm-6-34-ubuntu.tailec8707.ts.net → 127.0.0.1:7333
```
- Persisten via unit systemd user `tailscale-funnel.service` (enabled + linger → auto-start saat reboot).
- WAJIB: origin funnel masuk `ALLOWED_ORIGINS` di `.env.office` — tanpa ini asset browser ditolak 403 → halaman blank.
- WebSocket `/ws` otomatis ter-route.

**Opsi alternatif: subdomain** `office.lightvela.ai`
- Tambahkan DNS CNAME → platform LightVela / Cloudflare
- Konfigurasi proxy: `office.lightvela.ai/* → http://127.0.0.1:7333/*`
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

## 7. Update / Rollback

```bash
cd ~/niumination/hermes-office
git pull origin main
npm ci
npm run build
systemctl --user restart hermes-office   # dari terminal eksternal, bukan dari agent
```

Rollback: `git checkout <tag-sebelumnya> && npm ci && npm run build && restart`.
DB migration: office-server menjalankan migrasi idempotent saat start; untuk rollback major, restore `data/office.db` dari backup.

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
- **Auto-guest**: `GET /` menerbitkan session guest read-only dari
  `OFFICE_GUEST_TOKEN` (wajib terisi). Guest = read-only: presence + feed
  tampil; chat ke agent, detail event, **dan seluruh permukaan audit** tidak.
  Jangan memberikan `OFFICE_OWNER_TOKEN` ke browser publik untuk
  "memperbaiki" ini — auto-guest memang desainnya begitu.
- **Konsekuensi keamanan auto-guest**: karena funnel bersifat publik, redaksi
  guest adalah satu-satunya batas. Lihat docs/SECURITY.md §3 dan §9a.

## 11. Status Deployment Aktual (Okt 2026)

| Komponen | Status |
|---|---|
| Service `hermes-office` | aktif (user systemd), port 7333, env `.env.office` (0600) |
| Akses publik | Tailscale Funnel `https://vm-6-34-ubuntu.tailec8707.ts.net` |
| Unit funnel | `~/.config/systemd/user/tailscale-funnel.service` (enabled, linger=yes) |
| `ALLOWED_ORIGINS` | funnel origin + office.lightvela.ai + 127.0.0.1:7333 |
| Cloud hook | `~/.hermes/hooks/office-bridge` AKTIF — token `OFFICE_CLOUD_TOKEN` di `~/.hermes/.env` |
| Mac relay | siap, belum ter-install (menunggu Mac online) |
| Health | `curl -s http://127.0.0.1:7333/health` |

Catatan gotcha yang pernah terjadi:
- Blank page saat funnel baru aktif → penyebab: origin `*.tailec8707.ts.net` belum di `ALLOWED_ORIGINS` → 403 pada asset JS.
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
