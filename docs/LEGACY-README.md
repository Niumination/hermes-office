# 🏢 Hermes Office

> Kantor isometrik **bergaya donghua 3D** tempat denah lantai **adalah**
> kebijakan: setiap ruangan membawa tingkat kepercayaan, daftar alat,
> plafon tier model, anggaran per jam, dan aturan persetujuan sendiri.
> Memindahkan agen antar ruangan mengubah apa yang boleh ia lakukan.

> Pixel-art virtual office yang memvisualisasikan ekosistem [Niumination](https://github.com/Niumination) secara **real-time** — agent, channel messaging, tautan A2A, dan aktivitas repo GitHub, semuanya hidup dalam satu kantor isometrik.

**Status: 🟢 LIVE** — berjalan di server LightVela cloud, diakses publik via Tailscale Funnel.

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
| Tailnet | `http://<office-host>:7333` | Dari perangkat dalam tailnet |
| Demo | tambah `?mock=1` | Data mock, tanpa agent live |

> **Auto-guest:** tanpa token apa pun, `GET /` otomatis membuat session guest
> read-only. Karena funnel bersifat publik, **guest = pengunjung anonim mana
> pun di internet**. Semua endpoint v2 di bawah yang bertanda "guest diredaksi"
> karena itu merupakan satu-satunya batas, bukan lapisan tambahan.

Fitur owner (chat ke agent, detail event) butuh `OFFICE_OWNER_TOKEN` — lihat [docs/SECURITY.md](docs/SECURITY.md).

## Arsitektur singkat

- **`server/`** — Express 4 + ws + better-sqlite3. Endpoint: `/health`, `/event` (bridge-only), `/roster`, `/debug/events` (owner), `/github/feed`, `/chat`, `/auth/session`, WS `/ws`. Validasi event + redaction otomatis secret (lihat [docs/EVENTS.md](docs/EVENTS.md)).
- **`frontend/`** — React + Vite + TypeScript, pixel-art canvas (adaptasi Claude-Office), `?mock=1` untuk mode demo.
- **`bridges/hermes-cloud-hook/`** — Hermes gateway hook (`~/.hermes/hooks/office-bridge`) yang meneruskan lifecycle event (`gateway:startup`, `session:start`, `agent:step`, dst.) ke server. Fire-and-forget, tidak pernah memblokir gateway.
- **`bridges/mac-relay/`** — relay untuk Hermes Mac (launchd) yang men-tail audit log A2A dan mengirim event ke server.
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

## Endpoint v2 (ringkas)

| Endpoint | Peran | Fungsi |
|---|---|---|
| `POST /v1/traces` | bridge (`OFFICE_OTLP_TOKEN`) | Ingest OTLP GenAI, JSON saja (protobuf → 415) |
| `POST /policy/check` | bridge, owner | **Gerbang utama**: ruang → tool → tier model → anggaran |
| `POST /budget/check` | bridge, owner | Hanya anggaran. Digantikan `/policy/check`; dipertahankan untuk kompatibilitas |
| `GET /burn` | semua | Keadaan bakar. **Guest diredaksi** (tanpa nominal) |
| `GET /policy` | semua | Denah. **Guest diredaksi** (tanpa daftar tool/anggaran) |
| `GET /approvals` | semua | Antrian persetujuan. **Guest diredaksi** (tanpa agen/tool) |
| `GET /approvals/:id` | bridge, owner | Detail satu permintaan |
| `POST /approvals/:id` | owner | Putuskan (409 bila sudah diputus) |
| `POST /agents/:agent/room` | owner | Pindah ruang (**202** bila pintunya bergerbang) |
| `GET /ledger/head` | **owner** | Head rantai audit — nilai untuk dijangkarkan di luar sistem |
| `GET /ledger/verify` | **owner** | Hitung ulang rantai hash; laporkan putus pertama |
| `GET /ledger` | **owner** | Rekaman audit mentah |
| `GET /dossier` | **owner** | Dosir kepatuhan EU AI Act (`format=md\|json`) |

Redaksi guest didefinisikan di [SECURITY.md §3](docs/SECURITY.md).

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
| [docs/OTLP.md](docs/OTLP.md) | **v2** · Ingest OpenTelemetry GenAI (`POST /v1/traces`) |
| [docs/BURN-RATE.md](docs/BURN-RATE.md) | **v2** · Anggaran dolar & penegakan di jalur permintaan |
| [docs/POLICY.md](docs/POLICY.md) | **v2** · Policy-as-Floor-Plan: denah ruang = kebijakan |
| [docs/FLIGHT-RECORDER.md](docs/FLIGHT-RECORDER.md) | **v2** · Ledger hash-chained + dosir EU AI Act |
| [CHANGELOG-v2.md](CHANGELOG-v2.md) | **v2** · Catatan perubahan Fase 0–3 |

## Deployment saat ini (aktual, Okt 2026)

- Server: Ubuntu 24.04 @ lightvela.ai (cloud LightVela), user systemd `hermes-office` port **7333** — aktif
- Publik: Tailscale Funnel, unit `tailscale-funnel.service` (enabled + linger, auto-start saat reboot)
- Cloud hook: `~/.hermes/hooks/office-bridge` — **aktif**, event lifecycle mengalir live
- Mac relay: siap di `bridges/mac-relay/`, menunggu instalasi di MacBook (menunggu Mac online)
- GitHub feed: polling org `Niumination` (128 repo)

## Lisensi

MIT — turunan dari [Claude-Office](https://github.com/W17ant/Claude-Office) oleh W17ANT. Lihat [LICENSE](LICENSE) dan [CONTRIBUTING.md](CONTRIBUTING.md).


---

## Tema donghua 3D

12 ruangan, 18 pelat (varian siang/malam + @2x), 250 sprite — semua seni
nyata, nol placeholder.

Kesan 3D tidak datang dari geometri real-time melainkan dari **cahaya**:
`AtmosphereLayer.tsx` menjalankan satu fragment shader WebGL dengan god ray
volumetrik, debu di tiga bidang parallax, dan gradasi sinematik. Harganya
**+7,8 kB** pada bundle, dibanding ~250 kB untuk runtime 3D sungguhan.

Shader membaca **burn state** dari pelacak anggaran, jadi kantor berubah suhu
seiring belanja naik: sian tenang → amber → oranye → merah → biru dingin saat
breaker jatuh. Tata kelola dan arah seni adalah hal yang sama.

Tanpa WebGL2 lapisan ini tidak merender apa pun dan ruangan tetap tampil baik.
`prefers-reduced-motion` membekukan waktu, bukan menghapus informasinya.

Menyetel ulang sprite setelah mengganti seni:

```bash
python3 scripts/stylize-donghua.py frontend/public/sprites
```

Idempoten — selalu membaca dari `art-backup/`, jadi dijalankan berulang tidak
menumpuk efek.

## Setelah clone

```bash
npm ci && (cd frontend && npm ci && npm run build)
bash scripts/install-ci.sh     # .github/ tidak bertahan di setiap arsip
npm test                       # 154 backend
(cd frontend && npm test)      # 44 frontend
```
