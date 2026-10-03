# Mac Relay — Hermes Mac → Hermes Office

Relay event dari Mac ke office-server di cloud via Tailscale.

## Yang direlay

1. **Heartbeat** `agent_status` tiap 30s (server menandai Mac `away` bila hilang 90s)
2. **A2A audit** — baris baru di `~/.hermes/a2a_audit.jsonl` → event `a2a_task_in`

Yang TIDAK direlay (by design, privasi):
- Isi pesan/pertanyaan A2A (hanya metadata: peer, taskId)
- Chat Telegram, isi file, kegiatan lain

## Install

```bash
# 1. Salin folder ini ke Mac
scp -r bridges/mac-relay mac:~/.hermes/office-relay

# 2. Di Mac: taruh token (dari server, .env.office → OFFICE_MAC_TOKEN)
echo "OFFICE_MAC_TOKEN=<token>" >> ~/.hermes/.env

# 3. Pasang launchd
sed "s|CHANGEUSER|$(whoami)|g" \
  ~/.hermes/office-relay/com.niumination.office-relay.plist \
  > ~/Library/LaunchAgents/com.niumination.office-relay.plist
launchctl load ~/Library/LaunchAgents/com.niumination.office-relay.plist

# 4. Verify
tail -f ~/Library/Logs/office-relay.log
launchctl list | grep office
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.niumination.office-relay.plist
rm ~/Library/LaunchAgents/com.niumination.office-relay.plist
```

## Test manual (tanpa launchd)

```bash
export OFFICE_MAC_TOKEN=<token>
bash mac-relay.sh
# di terminal lain:
echo '{"peer":"cloud","task_id":"test-1"}' >> ~/.hermes/a2a_audit.jsonl
# → lihat event muncul di office
```


## Octo watcher (git_push → 🐙)

`octo-watcher.py` memindai repo git lokal (default: `~/Desktop/Niumination` di Mac, `~/niumination` di cloud) setiap 60 detik dan mengirim event `git_push` ke office server saat ada commit baru — karakter **Octo 🐙** muncul di meja GitHub.

Jalankan manual / launchd (Mac):
```bash
python3 octo-watcher.py            # foreground
python3 octo-watcher.py --once     # single scan (cron/launchd)
```

Di server cloud sudah berjalan sebagai systemd user unit `office-octo.service` (enabled). Token dibaca dari `OFFICE_MAC_TOKEN` / `OFFICE_CLOUD_TOKEN` (env atau `~/.hermes/.env`). Nama repo yang mengandung `brain/private/secret/vault` dilaporkan sebagai `[private]`.
