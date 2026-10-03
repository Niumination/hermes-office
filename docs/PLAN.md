# Hermes Office

> 🏢 Pixel-art virtual office yang memvisualisasikan ekosistem Hermes Agent milik [Niumination](https://github.com/Niumination) secara **real-time** — dua agent (Cloud + Mac), channel messaging, tautan A2A, dan aktivitas 128+ repo GitHub, semuanya hidup dalam satu kantor isometrik.

**Status: 📐 Perencanaan (M0 — spikes belum dimulai)**

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

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements, tujuan, fitur, milestone, risiko |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur teknis, data flow, layout repo |
| [docs/EVENTS.md](docs/EVENTS.md) | Kontrak event lengkap (sumber kebenaran bridge↔server) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy, systemd, proxy, operasi |
| [docs/SECURITY.md](docs/SECURITY.md) | Model ancaman, auth, sanitasi guest |
| [docs/UI-SPEC.md](docs/UI-SPEC.md) | Spesifikasi visual & interaksi |
| [docs/SPIKES.md](docs/SPIKES.md) | Rencana validasi M0 |

## Roadmap

- **M0** — Spikes: plugin capture, Mac relay, frontend port, chat streaming
- **M1** — Foundation: office-server + frontend jalan di server
- **M2** — Real integration: bridge Cloud & Mac, GitHub watcher
- **M3** — Chat & panels
- **M4** — Niu-mode, guest mode, polish → v1.0

## Lisensi & Kredit

- Kode dasar & sprite: [Claude-Office](https://github.com/W17ant/Claude-Office) oleh W17ANT — MIT
- Adaptasi Hermes Office: Niumination — MIT

---
*Dikelola oleh Hermes Cloud (LightVela) · diminta oleh Afrizal Munthe · Okt 2026*
