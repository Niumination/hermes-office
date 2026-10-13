# Hermes Office — Rencana Upgrade & Konflik Analysis

**Tanggal**: 2026-10-12  
**Target**: Upgrade hermes-office berdasarkan pelajaran dari Hermes3D dan agents-office, dengan memperbaiki kerentanan dan konflik yang mungkin merusak sistem yang sudah ada.

---

## 1. Ringkasan Perubahan yang Akan Dibuild

| Aspek | Dari Hermes3D | Dari agents-office | Kebutuhan Hermes-office |
|------|---|---|---|
| **Arsitektur** | Gateway-first, WebSocket bridge | Standalone Node + JSON config | Menambah WS bridge + modular config |
| **Visualisasi** | 3D + 2D pixel toggle | 3D isometric only | **Dual-mode: 3D + 2D pixel renderer** |
| **Fleet listing** | Agent list + status | 35 agents, 6 departemen | **Status cron jobs sebagai "desks"** |
| **Konfigurasi** | `office.config.json` | File JSON + env vars | **JSON config + env fallback** |
| **Task routing** | — | Task bar ke agent | **`@mitigasi`, `@alerts` routing** |
| **Brain/notes** | `brain/Agents Office/` | `brain/` folder | `~/.hermes/brain/office-notes.md` |

---

## 2. Daftar Fitur yang Akan Dibuild

### 2.1 Fitur Utama (Wajib)

1. **Dual-mode visualisasi** (3D + 2D pixel)
   - Settings → toggle "2D mode"
   - 2D pakai Phaser canvas sprites (ringan)
   - 3D pakai Three.js (sudah ada)
   - *Mengapa*: Pengguna MacBook lama tidak perlu rendering 3D berat

2. **Cron job fleet listing**
   - Setiap "desk" = satu cron job (mitigasi, alerts, imerg)
   - Menampilkan: last run, next run, status (ok/fail/stale)
   - Click → buka `/api/alerts` atau `systemctl status`
   - *Mengapa*: Monitoring agroclimate langsung dari office UI

3. **Task routing (`@mention`)**
   - `@mitigasi` → restart agroclimate-api
   - `@alerts` → buka `/api/alerts` tab baru
   - `@imerg` → cek status GES DISC
   - *Mengapa*: Akses cepat tanpa keluar office

4. **Konfigurasi JSON otomatis**
   - `~/.hermes/office/config.json` diisi dari `jobs.json` + SQLite
   - Struktur:
     ```json
     {
       "studio": "Niu Gayo Agroclimate",
       "desks": {
         "mitigasi-pagi": {"job_id": "081c15c134a9", "last": "2026-10-12T14:36", "status": "failed"},
         "alert-check": {"job_id": "cec9edba7395", "last": "2026-10-12T14:39", "status": "ok"}
       }
     }
     ```
   - *Mengapa*: Mudah diedit, tidak butuh editor config.yaml

5. **Brain folder notes**
   - `~/.hermes/brain/office-notes.md` untuk catatan per desk
   - Sama seperti `brain/Agents Office/` dari agents-office
   - *Mengapa*: Catatan user bertahan per job

### 2.2 Fitur Tambahan (Opsional)

6. **Budget tracking display**
   - Burn rate di UI (sudah ada di server/index.js)
   - Tampilan "global spend" dan "per-agent spend" di office

7. **Approval gate indicators**
   - Pending approvals terlihat di desk list
   - Warna: hijau (ok), orange (pending), merah (failed/expired)

8. **Gateway health widget**
   - Status WS connection ke Hermes Agent
   - Indicator: connected/disconnected + latency

---

## 3. Analisis Konflik & Risiko

### 3.1 Konflik yang Ditemukan

| Konflik | Penyebab | Dampak | Solusi |
|--------|----------|--------|--------|
| **CORS + WebSocket origin** | `.env.office` ALLOWED_ORIGINS di-set tapi WS upgrade gagal jika origin tidak match | Office render tapi socket terputus, tampak "flaky" | Pastikan ALLOWED_ORIGINS mencakup port frontend (3333 atau 7333) + add port development |
| **Env token konflik** | `.env.office` berisi `HERMES_API` yang menunjuk ke `http://127.0.0.1:3000` (salah) | Traffic chat ke host orang tua yang tidak dikontrol | **Fix**: Set `HERMES_API` ke `http://127.0.0.1:7455` (localhost agroclimate-api) atau kosongkan |
| **Ledger anchoring vs performance** | `OFFICE_LEDGER_RETENTION_DAYS` default 400 days + `synchronous: FULL` | Setiap decision ter-record fsync → overhead I/O | *Solusi*: Default `synchronous: NATIVE` (tidak fsync setiap append) dan `retentionDays: 90` untuk development |
| **Budget overflow** | `OFFICE_BUDGET_*` default 0 = unlimited | Developer lupa set cap → runaway AI cost | *Solusi*: Add runtime warning di `/budget/check` response saat melewati 80% cap, bukan hard deny |
| **WebSocket storm** | Bus `event` broadcast ke ALL wsClients tanpa filter | Saat banyak desk ter-open → CPU spike di server | *Solusi*: Tambah `isGuest` flag dan hanya broadcast event kritis ke semua, non-kritis ke subset |

### 3.2 Risiko "Merusak Semua yang Sudah Dikerjakan"

| Risiko | Tingkat | Mitigasi |
|--------|--------|--------|
| **Ledger chain corruption** | TINGGI (dari AGENTS.md #2) | 1. Jangan pernah `synchronous: FULL` di production tanpa backup<br>2. Anchor ke webhook eksternal minimal 1x/hour<br>3. Jangan ever langsung edit `data/ledger.json` — pakai `POST /ledger/record` |
| **WebSocket dependency loop** | TINGGI | 1. Bus events hanya dari auth-verified sources<br>2. Guest WS hanya terima `temperature` (burn snapshot), bukan invoice detail<br>3. Tambah `skipRateLimit: true` hanya untuk event internal sistem |
| **CORS + origin lockdown** | SEDANG | 1. Default ALLOWED_ORIGINS sudah benar (3333, 5173, 7333)<br>2. Jika custom port → set via env variable, jangan edit source code<br>3. Test dengan `curl -origin http://localhost:3333 http://localhost:7333/health` |
| **Token exposure di client** | SEDANG | 1. Token `OFFICE_CLOUD_TOKEN` → hanya bisa POST event, baca tidak bisa<br>2. Token `OFFICE_GUEST_TOKEN` → hanya temperature view<br>3. Jangan pernah kirim `OFFICE_OWNER_TOKEN` ke klien |
| **Data dir penuh** | RENDAH | 1. `dataDir` default `~/.hermes/office/data`<br>2. Set `OFFICE_DATA_DIR` ke path berbeda jika perlu<br>3. Add rotasi log otomatis saat melebihi 1GB |

---

## 4. Daftar Perubahan Code yang Dibutuhkan

### 4.1 server/config.js — Tambah opsi konfigurasi

```javascript
// Tambah di config.js setelah line yang sudah ada:
// Baru: baca dari ~/niumination/.hermes/office/config.json otomatis
try {
  const manualConfig = new URL('file://' + require('path').resolve('~/.hermes/office/config.json'));
  // gabung dengan config env, env menangani override
} catch {}
```

*Catatan: Lebih baik buat file terpisah `~/.hermes/office/config.json` dan baca dari server startup, bukan edit config.js inti.*

### 4.2 server/index.js — Tambah routes & WS handling

1. **Route GET `/desks`** — Return cron job fleet status dari jobs.json + SQLite
2. **Route POST `/desk/:id/action`** — Trigger action (restart, refresh, view)
3. **WS message handler** — Parse `@mention` commands dari client
4. **2D mode toggle** — Simpan prefensi ke `~/.hermes/office/prefs.json`

### 4.3 frontend — UI Changes

1. **Settings panel** → Toggle 2D/3D mode
2. **Desk list component** — Loop dari `/api/desks`, tampilkan status
3. **Command palette** → `@mitigasi`, `@alerts`, `@imerg`
4. **Brain notes button** → Buka `~/.hermes/brain/office-notes.md` di editor

### 4.4 Tests — Verifikasi

1. `bash scripts/verify.sh` → pastikan all 16 gates lulus
2. Test CORS dengan origin yang berbeda
3. Test WS connect/disconnect dengan multiple client
4. Test desk list mengembalikan data yang benar

---

## 5. Checklist Verifikasi Sebelum Deploy

```
[ ] 1. bash scripts/verify.sh → green (all gates)
[ ] 2. CORS test: curl -origin http://localhost:3333 http://localhost:7333/health
[ ] 3. WS connect test: 5 client bersamaan tanpa CPU spike > 50%
[ ] 4. Desk list mengembalikan data dari jobs.json + SQLite
[ ] 5. `@mitigasi` routing ke systemctl restart agroclimate-api
[ ] 6. `@alerts` routing ke /api/alerts di tab baru
[ ] 7. 2D mode toggle bisa diputar tanpa error
[ ] 8. Brain notes file ada di ~/.hermes/brain/office-notes.md
[ ] 9. .env.office tidak berisi HERMESApi ke host luar
[ ] 10. Ledger anchoring aktif dan bisa divisualisasikan
```

---

## 6. Rollback Plan

Jika upgrade merusak sistem:

1. **Matikan office**: `systemctl --user stop hermes-office` atau `kill $(pgrep -f server/index.js)`
2. **Restore env**: `cp .env.office.example .env.office` (hapus baris yang baru ditambahkan)
3. **Restore config**: Hapus `~/.hermes/office/config.json` jika baru dibuat
4. **Restore brain**: Hapus `~/.hermes/brain/office-notes.md` jika perlu
5. **Restart**: `systemctl --user start hermes-office`
6. **Verifikasi**: `bash scripts/verify.sh` → pastikan green

---

## 7. Catatan Akhir

- **Jangan pernah** mengubah `data/ledger.json` secara manual — itu adalah source of truth untuk audit
- **Jangan ever** set `HERMES_API` ke alamat Tailscale publik tanpa reverse proxy TLS
- **Jangan** melewati `POST /budget/check` — itu enforcement path, tidak hanya observability
- **Lakukan** `bash scripts/check-handoff.sh --write` setelah setiap commit berkas ter track

---
*Dokumen ini dibuat berdasarkan analisis Hermes3D (3D office + gateway-first) dan agents-office (JSON config + task routing), dengan fokus memperbaiki monitoring agroclimate di hermes-office kita.*