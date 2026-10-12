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
| guest | `OFFICE_GUEST_TOKEN` | GET WS (filtered), /roster, /desks (redacted) |

- Token 24+ byte hex, disimpan `.env.office` (0600), tidak pernah di log
- Rotasi: panel admin regenerate; bridge lama langsung invalid
- Guest: token di URL query dihindari (bocor di log) → gunakan `POST /auth/guest` tukar invite-code → session token

## 3. Filter Guest (server-side, WAJIB)

> **Sejak auto-guest (upstream, Okt 2026) bagian ini bukan lagi
> defence-in-depth — ia satu-satunya batas.** `GET /` otomatis menerbitkan
> session guest read-only untuk browser tanpa token, dan server dipublikasikan
> lewat Tailscale Funnel. Artinya **"pengunjung anonim di internet publik" dan
> "guest" kini principal yang sama**: setiap route `requireAny` efektif
> terbaca dunia. Redaksi di bawah ini yang menahannya, bukan kewajiban
> memiliki token.


Guest TIDAK menerima:
- `git_push` dengan `privat: true`
- Isi `office_chat` (hanya indikator "ada aktivitas chat")
- `a2a_task_*` `summary` (diganti "[redacted]")
- Field `url` internal / IP Tailscale

**Event tata kelola (Fase 2–3).** Guest boleh melihat *suhu* dan *denah*, tidak
boleh melihat *angka* dan *batas wewenang*:

| Event | Guest terima | Guest TIDAK terima |
|---|---|---|
| `budget_state` | `scope`, `state`, `from` | `spentUsd`, `limitUsd`, `subject` |
| `agent_moved` | `agent`, `room`, `fromRoom` | `grantedBy` (jawaban audit "kenapa boleh?") |
| `approval_requested` | `kind`, `room` | `agent`, `tool`, `reason`, `approvalId` |
| `approval_resolved` | `kind`, `room`, `state` | `agent`, `tool`, `decidedBy` |

**Permukaan REST juga, bukan hanya WS.** Meredaksi soket tidak ada gunanya bila
fakta yang sama bisa di-`GET`. Tiga endpoint baca baru punya cabang guest:

| Endpoint | Owner/bridge | Guest |
|---|---|---|
| `GET /burn` | angka penuh + per-agen | `state` + `ratio` saja, nominal di-nol-kan, `redacted: true` |
| `GET /policy` | denah penuh: `tools`, `approval`, `budgetHourlyUsd` | nama ruang, `trust`, penghuni — **tanpa** daftar tool/gerbang/anggaran |
| `GET /approvals` | `agent`, `tool`, `reason` | ada-tidaknya ketukan + `kind`/`room` |
| `GET /approvals/:id` | 200 | **403** — tampilan detail akan membuka kembali persis yang diredaksi daftar |

Alasannya recon: pengeluaran AI per jam adalah pengungkapan kompetitif, dan
daftar tool yang digerbangi adalah peta persis letak batas privilese.
"`deployer` ingin `kubectl` di server-room" adalah rencana serangan yang
diserahkan ke pengunjung baca-saja.

Implementasi: satu fungsi `sanitizeForGuest(event)` — unit test wajib untuk tiap event type.
Untuk endpoint, cabang `req.identity?.role !== "guest"`. Regresi dijaga lima test
di `tests/integration.test.js` ("Guest confidentiality on the governance surface"),
termasuk satu yang memverifikasi jalur WS, karena pelanggaran pertama lolos justru
dengan meredaksi REST saja.

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

## 9a. Jejak audit (Fase 4)

`GET /ledger*` dan `GET /dossier` adalah **owner-only, tanpa kecuali** —
termasuk tertutup untuk token **bridge**. Ledger adalah satu-satunya tempat
semua fakta yang diredaksi dari guest di §3 tertulis lengkap dan berdampingan:
siapa membelanjakan berapa, tool mana yang digerbangi, agen mana mencoba
melampaui cakupannya. Token bridge dipegang setiap proses agen, dan agen adalah
**subjek** catatan ini; memberi mereka akses baca berarti yang diawasi bisa
membaca daftar pengawasan.

Ekspor dosir dicatat ke dalam ledger itu sendiri (`dossier_exported`) — "siapa
menarik log audit" adalah pertanyaan yang auditor ajukan tentang log audit.

Nilai yang diinterpolasi ke dosir (nama agen, tool, ruang) **berasal dari span
OTLP**, jadi dipengaruhi penyerang. Semuanya dinetralkan sebelum dirender;
lihat docs/FLIGHT-RECORDER.md §6.

Rantai hash bersifat **tamper-evident, bukan tamper-proof**. Pemotongan ekor
dan penulisan ulang berkas tidak terdeteksi tanpa menjangkarkan head hash di
luar sistem. Jangan mengklaim lebih dari itu ke pelanggan.

## 9b. Catatan regresi (jujur)

Lima endpoint Fase 2–3 awalnya dikirim dengan `requireAny` dan membocorkan
pengeluaran per jam serta denah privilese lengkap ke token guest. Terdeteksi
saat audit pra-fase, bukan oleh test — karena tidak ada test yang menanyakannya.
Pelajaran yang sudah dikodekan: **setiap endpoint baru wajib punya baris di tabel
§3 dan satu test guest sebelum dianggap selesai.**

## 10. Checklist rilis

- [ ] Semua token baru dirotasi saat go-live pertama
- [ ] sanitizeForGuest test green untuk semua event type
- [ ] Rate limit test (burst) green
- [ ] Redaction test: tempel token fake di task summary → muncul [REDACTED]
- [ ] WS origin: koneksi dari origin asing ditolak
- [ ] Guest tidak bisa POST /chat (401)

## 11. Coordinated disclosure

Bagian ini ada karena tinjauan enterprise selalu menanyakannya, dan karena
proyek tanpa alamat pelaporan memaksa penemu memilih antara diam atau
membuka ke publik. Keduanya hasil yang buruk.

**Cara melapor.** Buka advisory privat lewat GitHub Security Advisories di
`Niumination/hermes-office` ("Report a vulnerability"). Jangan buka issue
publik untuk kerentanan. Jangan kirim bukti yang memuat token asli — lihat
§6; kalau Anda perlu menunjukkan token bocor, kirim prefiks dan hash-nya.

**Jendela tanggapan yang dijanjikan.** Ini komitmen waktu, bukan janji
perbaikan:

| Tahap | Dalam |
|---|---|
| Penerimaan laporan dikonfirmasi | 3 hari kerja |
| Penilaian awal: diterima, ditolak, atau butuh info | 10 hari kerja |
| Perbaikan atau mitigasi terdokumentasi untuk isu kritis | 90 hari |
| Advisory publik setelah perbaikan dirilis | 7 hari |

Kalau sebuah laporan ditolak, alasannya dikirim tertulis. Laporan yang
ditolak dengan alasan "di luar model ancaman" akan merujuk baris spesifik di
§1, dan kalau model ancamannya yang salah, itu yang diperbaiki.

**Yang dianggap kerentanan di sini.** Bypass filter guest (§3), kebocoran
token lewat jalur mana pun termasuk pipeline redaksi (§6), pemalsuan rantai
ledger yang lolos `verify()`, RCE, dan eskalasi dari `guest` atau `bridge` ke
`owner`.

**Yang bukan.** Temuan scanner otomatis tanpa jalur eksploitasi. Denial of
service lewat habisnya sumber daya pada instance yang Anda hosting sendiri —
rate limit ada, tapi ini bukan layanan multi-tenant. Dependensi dengan CVE
yang tidak bisa dicapai kode ini; `sbom.cdx.json` menyebutkan setiap paket
beserta versinya supaya Anda bisa menilai sendiri, bukan supaya kami
berpura-pura setiap CVE di pohon itu relevan.

**Safe harbour.** Penelitian dengan itikad baik terhadap instance Anda
sendiri tidak akan dilaporkan. Jangan uji instance orang lain.

**Tidak ada bug bounty.** Tidak ada uang. Kredit di advisory, kalau Anda
mau namanya disebut.
