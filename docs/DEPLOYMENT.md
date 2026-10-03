# Deployment & Operations — Hermes Office

## 1. Prasyarat Server

- Ubuntu 24.04 (server LightVela saat ini) — sudah ✓
- Node.js ≥ 20 — cek: `node -v` (install via nvm/nodesource bila belum)
- SQLite — bundled via better-sqlite3
- systemd user session aktif (sudah — dipakai hermes-gateway) ✓
- Akses reverse proxy (subdomain atau path) — via dashboard LightVela / Cloudflare

## 2. Struktur Deploy

```
/home/agentuser/hermes-office/        # app (git clone dari Niumination/hermes-office)
├── server/ frontend/ scripts/ ...
├── dist/                             # hasil vite build (gitignored)
├── data/office.db                    # SQLite (gitignored, backup harian)
└── .env.office                       # secret (0600, gitignored)
```

## 3. Langkah Deploy Pertama

```bash
# 1. Clone
git clone git@github.com:Niumination/hermes-office.git ~/hermes-office
cd ~/hermes-office

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

## 5. Reverse Proxy

**Opsi A (prefer): subdomain** `office.lightvela.ai`
- Tambahkan DNS CNAME → platform LightVela / Cloudflare
- Konfigurasi proxy: `office.lightvela.ai/* → http://127.0.0.1:7333/*`
- WAJIB: upgrade header `Connection` & `Upgrade: websocket` diteruskan (untuk /ws)

**Opsi B: path prefix** `lightvela.ai/office/`
- Rewrite `/office/(.*) → /$1` (frontend harus di-build dengan `base: '/office/'`)

**Opsi C: Tailscale-only** (tanpa expose publik)
- Akses `http://100.65.20.34:7333` dari device tailnet
- Set `ALLOWED_ORIGINS=http://100.65.20.34:7333`

## 6. Bridges Setup

### 6.1 Cloud bridge (di server ini)

```bash
cp bridges/hermes-cloud-plugin ~/.hermes/plugins/office-bridge -r
hermes config set plugins.office_bridge.url http://127.0.0.1:7333/event
# token: masukkan OFFICE_CLOUD_TOKEN ke plugin config (bukan plaintext di handler)
# aktif → perlu restart gateway dari DASHBOARD (atau tunggu reload plugin)
```

### 6.2 Mac relay (di Mac)

```bash
# salin bridges/mac-relay/ ke Mac, lalu:
export OFFICE_URL=http://100.65.20.34:7333/event
export OFFICE_TOKEN=<OFFICE_MAC_TOKEN>
bash mac-relay.sh install   # → menaruh launchd plist + load
```

Relay membaca `~/.hermes/a2a_audit.jsonl` + heartbeat file. Log: `~/Library/Logs/office-relay.log`.

## 7. Update / Rollback

```bash
cd ~/hermes-office
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
0 4 * * * sqlite3 ~/hermes-office/data/office.db ".backup ~/backups/office-$(date +\%F).db" && find ~/backups -name 'office-*.db' -mtime +14 -delete
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

## 10. Troubleshooting

| Gejala | Kemungkinan | Perbaikan |
|---|---|---|
| /health 404 dari luar | proxy belum pasang / WS headers | cek upgrade headers |
| Karakter tidak bergerak | bridge mati / token salah | `tail` log bridge; test POST manual |
| Mac tidak pernah `idle` | relay launchd mati | `launchctl list | grep office` |
| Chat tidak menjawab | Hermes API down / token | cek `HERMES_API` reachable dari office-server |
| OOM / memory naik | ring buffer bocor | cek retention job; restart |
