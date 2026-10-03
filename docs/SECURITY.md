# Security — Hermes Office

## 1. Model Ancaman

| Aktor | Ancaman |
|---|---|
| Internet random | Scan/menemukan endpoint, brute force token |
| Guest viewer | Mencoba melihat konten privat (repo 🔒, isi chat) |
| Peer A2A (Mac) yang dikompromikan | Mengirim event palsu / spam |
| Event payload berbahaya | Prompt injection / XSS via field teks (task summary, commit message) |
| Office-server sendiri | Menyimpan secret lebih dari perlu |

## 2. Autentikasi & Otorisasi

| Peran | Token | Bisa |
|---|---|---|
| cloud-bridge | `OFFICE_CLOUD_TOKEN` | POST /event, GET /roster |
| mac-bridge | `OFFICE_MAC_TOKEN` | POST /event, GET /roster |
| owner | `OFFICE_OWNER_TOKEN` | Semua kecuali /event |
| guest | `OFFICE_GUEST_TOKEN` | GET WS (filtered), /roster, /github/feed (sanitized) |

- Token 24+ byte hex, disimpan `.env.office` (0600), tidak pernah di log
- Rotasi: panel admin regenerate; bridge lama langsung invalid
- Guest: token di URL query dihindari (bocor di log) → gunakan `POST /auth/guest` tukar invite-code → session token

## 3. Filter Guest (server-side, WAJIB)

Guest TIDAK menerima:
- `git_push` dengan `privat: true`
- Isi `office_chat` (hanya indikator "ada aktivitas chat")
- `a2a_task_*` `summary` (diganti "[redacted]")
- Field `url` internal / IP Tailscale

Implementasi: satu fungsi `sanitizeForGuest(event)` — unit test wajib untuk tiap event type.

## 4. Input Hardening

- Schema validation ketat: unknown type → 400; field tambahan dihapus
- String clamp (500/4000 char)
- Body limit 16 KB
- CORS: `ALLOWED_ORIGINS` allowlist; WS origin check
- Rate limit per token + global burst limiter
- `Content-Type: application/json` wajib utk /event & /chat

## 5. XSS / Injection

- Frontend merender SEMUA teks event sebagai text node (bukan HTML) — React default
- Tidak ada `dangerouslySetInnerHTML` untuk data eksternal
- Markdown di chat panel: renderer dengan sanitasi (DOMPurify) atau plain-text saja
- Commit message / task summary di-escape otomatis oleh React

## 6. Secret Hygiene

- Token bridge tidak pernah masuk payload event
- Redaction rules (lihat EVENTS.md §5) berlaku sebelum persist & broadcast — dua lapis
- Log tidak memuat body request penuh (hanya meta: type, source, size)
- GitHub token office-server: pakai token cloud yang sudah ada via env, scope read-only public+privat metadata (tidak write)

## 7. Transport

- Wajib HTTPS/WSS di produksi (proxy platform)
- HSTS disarankan di level proxy
- Tailscale path (opsi C) aman via WireGuard, boleh HTTP lokal

## 8. Anti-Abuse Agent Loop

Chat `@mac` → A2A:
- Hard cap 1 turn (default), configurable max 3
- Cooldown 60s per context
- Balasan Mac di-sanitize (redaction) sebelum ditampilkan

## 9. Data Retention & Privacy

| Data | Retensi |
|---|---|
| events ring buffer | 7 hari / 100k baris |
| chat history | permanen (kecil), bisa dihapus owner via panel |
| backup DB | 14 hari lokal |

Tidak ada telemetry eksternal. Tidak ada data yang keluar dari server kecuali ke browser owner/guest yang terautentikasi.

## 10. Checklist rilis

- [ ] Semua token baru dirotasi saat go-live pertama
- [ ] sanitizeForGuest test green untuk semua event type
- [ ] Rate limit test (burst) green
- [ ] Redaction test: tempel token fake di task summary → muncul [REDACTED]
- [ ] WS origin: koneksi dari origin asing ditolak
- [ ] Guest tidak bisa POST /chat (401)
