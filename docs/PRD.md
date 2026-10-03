# PRD — Hermes Office (Niumination)

**Status:** Draft v1.0 · **Tanggal:** 3 Okt 2026 · **Pemilik:** Afrizal Munthe ("zaryu") · **Penyusun:** Hermes Cloud Agent (LightVela)

---

## 1. Ringkasan Eksekutif

Hermes Office adalah aplikasi web real-time bergaya *isometric pixel-art virtual office* yang memvisualisasikan ekosistem AI agent milik Afrizal Munthe secara live. Diadaptasi dari proyek open-source [Claude-Office](https://github.com/W17ant/Claude-Office) (MIT), proyek ini mengganti sumber data dari Claude Code hooks menjadi **Hermes Agent telemetry** — mencakup dua instance Hermes (Cloud di lightvela.ai dan Mac lokal), channel messaging (Telegram, WhatsApp), tautan A2A, dan aktivitas GitHub org Niumination (128 repo).

Aplikasi di-deploy di server LightVela milik pengguna (bukan Workbench static hosting), diakses via subdomain, dan menjadi "pusat komando visual" ekosistem.

**Tujuan satu kalimat:** *Buka satu halaman, lihat seluruh ekosistem AI kamu hidup — siapa yang sedang bekerja, channel apa yang aktif, repo apa yang baru berubah — dalam kantor pixel art yang charming.*

---

## 2. Latar Belakang & Masalah

### 2.1 Kondisi saat ini

Ekosistem Afrizal tersebar dan tidak terlihat sebagai satu kesatuan:

| Komponen | Lokasi | Cara pantau saat ini |
|---|---|---|
| Hermes Cloud | Server LightVela (lightvela.ai) | Chat Telegram DM |
| Hermes Mac | MacBook Pro (~zaryu) | Telegram DM + desktop app |
| A2A link | Tailscale 100.65.20.34 ↔ 100.120.57.37:9900 | Log file / tes manual |
| Telegram/WhatsApp gateway | Kedua instance | Dashboard LightVela |
| GitHub org Niumination | ~128 repo | github.com |
| Cron & notifikasi | LightVela-Group topic #5 | Telegram |

Tidak ada satu tempat untuk *melihat* ekosistem secara menyeluruh dan real-time.

### 2.2 Mengapa Claude-Office menarik

- Metafora visual yang kuat: kantor = ekosistem, karakter = agent, meja = tugas
- Sudah terbukti berfungsi (Express + WS + React, MIT)
- Estetika pixel art yang konsisten dan charming, day/night cycle
- Event contract sederhana (POST /event → broadcast WS) yang mudah diadaptasi

### 2.3 Gap yang harus diatasi

1. Claude-Office membaca hook Claude Code; Hermes punya arsitektur berbeda (gateway, A2A audit log, cron scheduler)
2. Claude-Office chat AI memanggil `claude -p` CLI; Hermes punya gateway sendiri
3. Tidak ada konsep GitHub activity di Claude-Office
4. Claude-Office dirancang single-machine localhost; kita butuh remote access + multi-source (2 mesin)

---

## 3. Goals & Non-Goals

### 3.1 Goals

| # | Goal |
|---|---|
| G1 | Visualisasi real-time seluruh agent Hermes (Cloud + Mac) dalam satu kantor isometrik |
| G2 | Event pipeline: aktivitas Hermes (tool calls, A2A tasks, cron, git push) → server → browser < 2 detik |
| G3 | Panel chat yang terhubung ke Hermes Cloud (bertanya ke agent dari dalam kantor) |
| G4 | Panel GitHub: feed aktivitas repo org Niumination (push, PR, star) |
| G5 | Akses publik yang aman via subdomain lightvela.ai (auth token, HTTPS) |
| G6 | Dukungan "mode tribute" seperti /the-office pada aslinya → versi kita: /niu-mode (tema Niumination) |
| G7 | Deploy sebagai systemd service, survive reboot, auto-restart |

### 3.2 Non-Goals (v1)

- ❌ Mobile native app (responsif web cukup)
- ❌ Multi-tenant / multi-user accounts (single owner + read-only guests)
- ❌ Menulis ke ekosistem (read-only visualization; chat ke agent adalah satu-satunya aksi)
- ❌ Mac agent spawning visual (Mac ditampilkan sebagai satu karakter, bukan sub-agent-nya)
- ❌ Workbench static export (ini inherently serverful)

---

## 4. User Personas & Stories

### Persona 1: Afrizal (Owner/Admin)

- US1: Sebagai owner, saya membuka hermes.lightvela.ai dan langsung melihat karakter Hermes Cloud mengetik di mejanya ketika saya memberinya tugas via Telegram.
- US2: Sebagai owner, saat saya kirim tugas A2A ke Mac, karakter "Mac Agent" berjalan ke meja dan menampilkan speech bubble isi tugas.
- US3: Sebagai owner, saya bisa chat dengan Hermes Cloud langsung dari panel office chat.
- US4: Sebagai owner, saya melihat feed "commit baru ke Niumination/brain" muncul sebagai event di office.
- US5: Sebagai owner, saya bisa toggle AI mode off agar hemat token.

### Persona 2: Tamu (read-only viewer)

- US6: Sebagai tamu dengan link invite, saya bisa melihat kantor & aktivitas tanpa bisa chat atau lihat detail sensitif.

### Persona 3: Agent (sistem)

- US7: Sebagai Hermes Cloud, saya mem-publish event (spawn selesai, cron selesai, A2A diterima) ke office secara otomatis.
- US8: Sebagai Hermes Mac, saya melakukan hal yang sama via A2A/relay.

---

## 5. Arsitektur

### 5.1 Gambaran umum

```
┌─────────────────────┐     A2A/HTTP      ┌──────────────────────────┐
│  Hermes Mac (zaryu) │ ────────────────► │                          │
│  event-relay.sh     │                   │   Hermes Office Server   │
└─────────────────────┘                   │   (Node/Express + WS)    │
                                          │   lightvela.ai:7333      │
┌─────────────────────┐     HTTP POST     │                          │
│  Hermes Cloud       │ ────────────────► │  ┌────────────────────┐  │
│  (gateway hooks/    │                   │  │ Event Bus          │  │
│   plugin watcher)   │                   │  └─────────┬──────────┘  │
└─────────────────────┘                   │            │ broadcast   │
                                          │  ┌─────────▼──────────┐  │
┌─────────────────────┐                   │  │ WS → Browser       │  │
│  GitHub (Niumination│ ◄─────────────────┤  └─────────┬──────────┘  │
│  webhooks/polling)  │   REST API        │            │             │
└─────────────────────┘                   │  ┌─────────▼──────────┐  │
                                          │  │ React Frontend     │  │
                                          │  │ (pixel office)     │  │
                                          │  └────────────────────┘  │
                                          │  SQLite (chat + events)  │
                                          └──────────────────────────┘
```

### 5.2 Komponen

| Komponen | Teknologi | Tanggung jawab |
|---|---|---|
| **office-server** | Node 20 + Express 4 + ws | Terima event (HTTP POST), autentikasi, broadcast WS, serve static build |
| **event-bridge-cloud** | Hermes plugin (`~/.hermes/plugins/office-bridge/`) | Hook ke lifecycle Hermes Cloud: `post_tool_call`, cron completion, A2A inbound; POST ke office-server |
| **event-bridge-mac** | Shell script + launchd (di Mac) | Tail A2A audit log + hermes logs; POST ke office-server via Tailscale |
| **github-watcher** | Bagian dari office-server | Polling GitHub API (ETA: webhooks jika org permit) setiap 60s; emit event push/PR |
| **chat-bridge** | office-server → Hermes API server (`localhost:3000/v1/chat/completions`) | meneruskan chat panel ke Hermes Cloud; streaming balikan ke panel |
| **frontend** | React 18 + Vite + TS (port dari Claude-Office src/) | Render isometric office, karakter, speech bubbles, panels |
| **db** | SQLite (better-sqlite3) | chat history + event log (ring buffer 7 hari) |

### 5.3 Event contract (adaptasi dari Claude-Office)

Event types yang diwarisi: `agent_spawned`, `agent_finished`, `tool_call`, `tool_done`, `mcp_call`, `office_chat`.

Event types baru:

| Type | Sumber | Payload |
|---|---|---|
| `a2a_task_in` | A2A audit | `{from, task, contextId}` |
| `a2a_task_out` | A2A audit | `{to, task, state}` |
| `cron_fired` | cron scheduler | `{job, target}` |
| `git_push` | GitHub watcher | `{repo, author, commits, additions}` |
| `channel_msg` | gateway logs | `{platform, chat, direction}` |
| `agent_status` | heartbeat | `{agent: cloud|mac, state: idle|working|away}` |

### 5.4 Keamanan

- Token bearer per-source (cloud-bridge, mac-bridge) — file 0600
- HTTPS via reverse proxy (Cloudflare/LightVela platform, subdomain `office.lightvela.ai`)
- Rate limit: 60 req/min per source
- Origin allowlist WebSocket
- Guest mode: token read-only, events disanitasi (repo privat tidak ditampilkan)
- Secret redaction: pola API-key/JWT disaring dari semua event & chat

### 5.5 Deployment

- Server: `/opt/hermes-office/` (atau `~/hermes-office/`), systemd unit `hermes-office.service` (user unit, selaras hermes-gateway)
- Port internal: 7333 (hindari bentrok 3000/3334/9900)
- Build frontend: `vite build` → dist/ diserve Express
- Log: `~/.hermes/logs/office.log` (atau journald)

---

## 6. Spesifikasi Fitur (v1)

### F1. Kantor Isometrik (port + modifikasi dari Claude-Office)

- Peta kantor: 6-8 meja. Meja tetap: Hermes Cloud, Hermes Mac, Boss (Afrizal)
- Meja dinamis: muncul saat event `git_push` (karakter "GitHub Octo" duduk sebentar), `cron_fired` (karakter "Cron Runner")
- Day/night cycle 24 jam real (sinkron WIB)
- Random office events (pizza delivery, printer jam) — dipertahankan dari asli
- Sound effects toggle (default off)

### F2. Panel Agents

- Sidebar kanan: daftar agent + status real-time (idle/working/away) + task terakhir
- Klik karakter → popup detail: agent itu siapa, jalur aksesnya (Telegram/A2A/dll), tugas terakhir, uptime

### F3. Office Chat (Hermes-powered)

- Chat panel bergaya Slack, terhubung ke Hermes Cloud via API server lokal
- Multi-agent routing sederhana: pesan mengandung "@mac" → diteruskan via A2A ke Mac (dengan batas 1 pertanyaan/reply untuk mencegah loop)
- Slash commands: `/status`, `/agents`, `/repos`, `/niu-mode`
- Persist di SQLite; typing indicator; reaksi emoji

### F4. GitHub Panel

- Tab di bawah chat: feed aktivitas org Niumination
- Event: push (repo, author, +x/-y), PR open/merge, star baru
- Polling 60s (GitHub API gratis tier cukup untuk 128 repo check `pushed_at` delta)

### F5. Niu-Mode (Easter Egg)

- `/niu-mode` mengganti tema: palet Niumination, karakter jadi tim Niu, chatter berbahasa Indonesia, prop khas (laptop sticker, kopi Aceh)
- State persist di localStorage

### F6. Admin & Auth

- Login owner: token (disimpan localStorage)
- Guest link: `?guest=<token>` → read-only, tanpa chat input, tanpa repo privat
- Panel admin sederhana: regenerate token, lihat connected sources

---

## 7. Data Model

### SQLite Schema (ringkas)

```sql
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY,
  role TEXT CHECK(role IN ('user','agent','system')),
  agent TEXT,               -- 'cloud' | 'mac'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen INTEGER DEFAULT 0
);

CREATE TABLE reactions (
  message_id INTEGER REFERENCES chat_messages(id),
  emoji TEXT,
  count INTEGER DEFAULT 1,
  PRIMARY KEY (message_id, emoji)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,     -- JSON
  source TEXT NOT NULL,      -- 'cloud' | 'mac' | 'github' | 'system'
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_created ON events(created_at DESC);
-- retention: DELETE WHERE created_at < now - 7d (harian)
```

---

## 8. API Spec (office-server)

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | /event | source token | Terima event dari bridge |
| GET | /ws | origin check | WebSocket stream |
| GET | /roster | any | Daftar agent + status |
| POST | /chat | owner token | Kirim chat → Hermes |
| POST | /chat/typing | owner | Broadcast typing |
| POST | /chat/react | owner | Reaksi emoji |
| GET | /github/feed | any (sanitized utk guest) | Feed aktivitas GitHub |
| GET | /health | none | Health check |
| GET | /api/agents | owner | Detail lengkap agent |

---

## 9. Milestone & Roadmap

### M0 — Spike & Validasi (2-3 hari)

| Spike | Pertanyaan | Metode |
|---|---|---|
| S1 | Apakah event dari Hermes plugin lifecycle bisa ditangkap? | Buat plugin minimal `office-bridge`, emit `post_tool_call`, lihat sampai server |
| S2 | Apakah Mac bisa relay event via Tailscale dengan latensi ok? | Script tail audit log → POST → ukur latensi |
| S3 | Apakah Claude-Office frontend bisa di-build & jalan tanpa server aslinya? | Port frontend, mock event, render |
| S4 | Chat bridge ke Hermes API server: streaming berfungsi? | Endpoint `/v1/chat/completions` + SSE |

**Exit criteria:** 4 spike VALIDATED, arsitektur tidak berubah signifikan.

### M1 — Foundation (3-4 hari)

- Fork/ struktur repo `Niumination/hermes-office`
- office-server dasar: /event, /ws, /roster, auth, SQLite
- Frontend port: office render, karakter, day/night
- systemd service + deploy ke server
- **Deliverable:** kantor pixel art jalan di hermes.lightvela.ai dengan event mock

### M2 — Real Integration (4-5 hari)

- event-bridge-cloud (Hermes plugin)
- event-bridge-mac (script + launchd di Mac)
- github-watcher (polling)
- Real events menggerakkan karakter
- **Deliverable:** buka halaman, beri tugas via Telegram → karakter merespons

### M3 — Chat & Panels (3-4 hari)

- Office chat → Hermes Cloud (streaming)
- GitHub feed panel
- Panel agents + detail popup
- **Deliverable:** fitur inti lengkap

### M4 — Polish & Niu-Mode (2-3 hari)

- Niu-mode theme
- Guest mode + sanitasi
- Sound toggle, mobile responsive pass
- Dokumentasi README
- **Deliverable:** v1.0 release, tag, deploy stabil

**Total estimasi: 12-16 hari kerja agent** (bisa dipadatkan dengan delegasi paralel)

---

## 10. Risiko & Mitigasi

| # | Risiko | Prob. | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | Hermes plugin API berubah (v0.21 cepat bergerak) | Sedang | Sedang | Pin versi, plugin kecil & terisolasi, test di update |
| R2 | LightVela platform proxy tidak bisa route subdomain baru | Sedang | Tinggi | Fallback: path prefix `lightvela.ai/office/` atau port langsung via Tailscale |
| R3 | Mac offline sering → office terasa "mati" | Tinggi | Rendah | Desain: karakter Mac masuk "away mode", bukan error |
| R4 | GitHub API rate limit (128 repo × 60s) | Rendah | Rendah | Conditional request (ETag), batch, atau webhooks |
| R5 | Chat bridge menimbulkan loop agent-agent | Rendah | Tinggi | Hard cap 1 turn, tidak ada auto-reply antar agent dari chat |
| R6 | Port 7333 diblok firewall LightVela | Rendah | Sedang | Route via platform proxy / Tailscale-only fallback |
| R7 | Estetika pixel art asli tidak match selera | Rendah | Rendah | Niu-mode theme sebagai alternatif |

---

## 11. Keputusan Desain (ADR ringkas)

| # | Keputusan | Alternatif | Alasan |
|---|---|---|---|
| D1 | Server Node/Express (port dari Claude-Office) | Tulis ulang Python | Reuse 80% kode teruji; faster to ship |
| D2 | Polling GitHub API dulu, webhooks kemudian | Webhooks langsung | Webhooks butuh org admin setup + public URL per-repo; polling cukup utk v1 |
| D3 | Mac relay via shell script + launchd | Plugin Hermes di Mac | Lebih sedikit moving parts di Mac; Mac sering offline |
| D4 | SQLite (sama dengan asli) | Postgres/Redis | Scale kecil, zero-ops, sudah terbukti |
| D5 | Chat hanya ke Hermes Cloud (Mac via A2A one-shot) | Direct ke Mac | Simpler; Mac sering offline |
| D6 | Subdomain `office.lightvela.ai` | Path prefix | Cookie/token isolation lebih bersih |

---

## 12. Definition of Done (v1.0)

- [ ] Semua spike VALIDATED
- [ ] Repo `Niumination/hermes-office` dengan README, docs/, CI lint
- [ ] https://office.lightvela.ai live, survive reboot
- [ ] Event end-to-end: Telegram task → karakter animasi < 2s
- [ ] Mac events terlihat saat Mac online
- [ ] GitHub feed menampilkan push < 60s
- [ ] Chat panel berfungsi dengan streaming
- [ ] Guest mode disanitasi (verifikasi tidak ada repo privat bocor)
- [ ] Niu-mode toggle berfungsi
- [ ] Dokumentasi instalasi & arsitektur di docs/

---

## 13. Dokumen Terkait

- `docs/ARCHITECTURE.md` — detail teknis arsitektur
- `docs/EVENTS.md` — spesifikasi event contract lengkap
- `docs/DEPLOYMENT.md` — panduan deploy & operasi
- `docs/SECURITY.md` — model ancaman & mitigasi
- `docs/UI-SPEC.md` — wireframe & asset pixel art
- `docs/SPIKES.md` — hasil spike M0

---

*Dokumen ini disusun oleh Hermes Cloud berdasarkan inspeksi langsung source Claude-Office (MIT) dan kondisi infrastruktur LightVela per 3 Oktober 2026.*
