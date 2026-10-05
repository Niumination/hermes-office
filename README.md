# 🏢 Hermes Office

> Pixel-art virtual office yang memvisualisasikan ekosistem [Niumination](https://github.com/Niumination) secara **real-time** — agent, channel messaging, tautan A2A, dan aktivitas repo GitHub, semuanya hidup dalam satu kantor isometrik.

**Status: 🟢 LIVE — dual-space** — berjalan di server LightVela cloud, diakses publik via Tailscale Funnel. Ruang **Server Room ☁️** + **Mac Studio 💻** sudah aktif (M-A selesai), **mac-relay terpasang di Mac** (heartbeat 30s, mac online di presence), dan **auto-guest session** membuat halaman publik menampilkan presence nyata tanpa owner token.

> ☁️ **Repo ini dikelola dari lightvela.ai** oleh tim Niumination — seluruh development, deployment, dan operasionalnya dijalankan oleh Hermes Agent di server cloud LightVela (dengan dukungan peer Hermes Mac via A2A).

---

## Apa ini?

Diadaptasi dari [Claude-Office](https://github.com/W17ant/Claude-Office) (MIT), Hermes Office mengganti sumber event dari Claude Code hooks menjadi **telemetri Hermes Agent**:

```
Hermes Cloud ─┐
Hermes Mac ───┼──► office-server (Express+WS) ──► Browser (React pixel office)
GitHub org ───┘         │
                     SQLite (chat + events)
```

Buka halamannya, dan lihat: karakter Hermes Cloud mengetik saat mengerjakan tugasmu di Telegram, Hermes Mac "datang kerja" saat laptop menyala, gurita GitHub muncul tiap ada push, dan chat panel yang terhubung langsung ke agent.

## Akses

| Jalur | URL | Catatan |
|---|---|---|
| Publik (HTTPS) | `https://vm-6-34-ubuntu.tailec8707.ts.net` | Tailscale Funnel → port 7333, tanpa install apa pun |
| Tailnet | `http://100.65.20.34:7333` | Dari perangkat dalam tailnet |
| Demo | tambah `?mock=1` | Data mock, tanpa agent live |

Fitur owner (chat ke agent, detail event) butuh `OFFICE_OWNER_TOKEN` — lihat [docs/SECURITY.md](docs/SECURITY.md). Tanpa token apapun, `GET /` otomatis membuat **session guest read-only** (cookie dari `OFFICE_GUEST_TOKEN`): presence nyata tampil, tapi chat/detail event tersembunyi.

## Arsitektur singkat

- **`server/`** — Express 4 + ws + better-sqlite3. Endpoint: `/health`, `/event` (bridge-only), `/roster`, `/debug/events` (owner), `/github/feed`, `/chat`, `/auth/session`, WS `/ws`. Validasi event + redaction otomatis secret (lihat [docs/EVENTS.md](docs/EVENTS.md)).
- **`frontend/`** — React + Vite + TypeScript, pixel-art canvas (adaptasi Claude-Office), `?mock=1` untuk mode demo.
- **`bridges/hermes-cloud-hook/`** — Hermes gateway hook (`~/.hermes/hooks/office-bridge`) yang meneruskan lifecycle event (`gateway:startup`, `session:start`, `agent:step`, dst.) ke server. Fire-and-forget, tidak pernah memblokir gateway.
- **`bridges/mac-relay/`** — relay untuk Hermes Mac (launchd, `com.niumination.office-relay`) yang men-tail audit log A2A dan mengirim event ke server, plus heartbeat 30s → mac tampil online di `/presence`. **Sudah terpasang di Mac** (A2A_BEARER_TOKEN di-hardening ke `~/.hermes/.env`, tidak lagi di plist — lihat `bridges/mac-relay/MAC-PLAYBOOK-TONIGHT.md` untuk panduan tahapan & hardening A2A).
- **`data/`** — SQLite (chat + events), gitignored.

## Menjalankan

```bash
npm ci --omit=dev
cp .env.office.example .env.office   # isi token, chmod 600
npm run build --workspace frontend   # atau: cd frontend && npm ci && npm run build
bash scripts/install-service.sh      # systemd user unit `hermes-office` (port 7333)

# verifikasi
curl -s http://127.0.0.1:7333/health
```

Publik via Tailscale Funnel (sekali setup, persisten via systemd `tailscale-funnel.service`):

```bash
sudo tailscale funnel --bg 7333      # https://<hostname>.ts.net → 127.0.0.1:7333
```

Penting: tambahkan origin publik (mis. `https://<hostname>.ts.net`) ke `ALLOWED_ORIGINS` di `.env.office`, lalu restart service — tanpa ini asset ditolak 403 dan halaman blank.

## Testing

```bash
node --test tests/eventbus.test.js tests/integration.test.js   # 19 test
```

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Rencana awal & latar (status historis) |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur teknis |
| [docs/EVENTS.md](docs/EVENTS.md) | Kontrak event + redaction |
| [docs/SECURITY.md](docs/SECURITY.md) | Peran token & keamanan |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment & operasional |
| [docs/UI-SPEC.md](docs/UI-SPEC.md) | Spesifikasi UI pixel-art |
| [docs/SPIKES.md](docs/SPIKES.md) | Catatan spike M0 |

## Deployment saat ini (aktual, Okt 2026)

- Server: Ubuntu 24.04 @ lightvela.ai (cloud LightVela), user systemd `hermes-office` port **7333** — aktif
- Publik: Tailscale Funnel, unit `tailscale-funnel.service` (enabled + linger, auto-start saat reboot)
- Cloud hook: `~/.hermes/hooks/office-bridge` — **aktif**, event lifecycle mengalir live
- Mac relay: **TERPASANG di Mac** — launchd `com.niumination.office-relay.plist`, heartbeat 30s → mac `online: true` di `/presence`. Hardening A2A selesai: `A2A_BEARER_TOKEN` dipindah ke `~/.hermes/.env` di Mac (terbukti cold boot), dihapus dari plist (plist mode 600 tanpa token), `chmod 600 a2a-token.txt`, `scripts/reload-gateway.sh` 8/8 test. Panduan: `bridges/mac-relay/MAC-PLAYBOOK-TONIGHT.md`.
- GitHub feed: polling org `Niumination` (128 repo)

## Lisensi

MIT — turunan dari [Claude-Office](https://github.com/W17ant/Claude-Office) oleh W17ANT. Lihat [LICENSE](LICENSE) dan [CONTRIBUTING.md](CONTRIBUTING.md).
