# Security — Hermes Office

## 1. Model Ancaman

| Aktor | Ancaman |
|---|---|
| Internet random | Scan/menemukan endpoint, brute force token |
| Pengunjung anonim | Mencoba membaca apa pun tanpa token — denah, roster, isi chat |
| Peer A2A (Mac) yang dikompromikan | Mengirim event palsu / spam |
| Event payload berbahaya | Prompt injection / XSS via field teks (task summary, commit message) |
| Office-server sendiri | Menyimpan secret lebih dari perlu |

## 2. Autentikasi & Otorisasi

| Peran | Token | Bisa |
|---|---|---|
| cloud-bridge | `OFFICE_CLOUD_TOKEN` | POST /event, GET /roster |
| mac-bridge | `OFFICE_MAC_TOKEN` | POST /event, GET /roster |
| owner | `OFFICE_OWNER_TOKEN` | Semua kecuali /event |

- Token 24+ byte hex, disimpan `.env.office` (0600), tidak pernah di log
- Rotasi: panel admin regenerate; bridge lama langsung invalid
- Token tidak pernah lewat URL query (bocor di log) → `POST /auth/session` dengan header `Authorization: Bearer` → cookie `office_session` HttpOnly, SameSite=Lax, 12 jam
- Token tak dikenal dijawab **401**, bukan 403: tidak ada peran yang valid-tetapi-kurang-wewenang di permukaan ini

## 3. Satu Principal (server-side, WAJIB)

> **Perubahan Okt 2026: peran `guest` dicabut seluruhnya.** Sebelumnya `GET /`
> dan `GET /kiosk` otomatis menerbitkan sesi tamu baca-saja untuk browser tanpa
> token, dan server dipublikasikan lewat tunnel. Artinya "pengunjung anonim di
> internet publik" dan "guest" adalah principal yang sama: setiap route
> `requireAny` efektif terbaca dunia, dan yang menahannya hanyalah pipeline
> redaksi — bukan kewajiban memiliki token.

**Kenapa redaksi dibuang, bukan diperketat.** Pipeline itu bekerja: ia
menyembunyikan nominal, isi chat, nama repo privat, dan daftar tool. Tapi ia
memindahkan batas keamanan dari satu tempat (apakah pemanggil punya token) ke
belasan tempat (apakah setiap field di setiap event dan setiap endpoint sudah
disaring untuk peran ini). Pelanggaran pertama yang tercatat di repo ini lolos
justru karena REST diredaksi dan WS tidak. Batas yang harus diingat di belasan
tempat adalah batas yang akan bocor; batas yang satu tempat tidak.

Kantor ini punya satu penghuni. Maka:

| Peran | Boleh |
|---|---|
| owner | semua kecuali `POST /event` |
| cloud-bridge / mac-bridge | `POST /event`, `GET /roster`, dan permukaan `requireAny` |
| tanpa sesi | `GET /health`, `GET /` (cangkang halaman masuk). Selesai. |

`GET /health` tetap terbuka tanpa auth — itulah cara tunnel tahu kantor hidup —
dan sengaja tidak memuat fakta apa pun selain uptime. `GET /` menyajikan
cangkang aplikasi tanpa mencetak sesi: pengunjung melihat formulir masuk, bukan
404, supaya pemilik tidak terkunci dari UI-nya sendiri.

Yang ikut tercabut: `OFFICE_GUEST_TOKEN`, `autoGuestSession`, rute `/kiosk`,
`sanitizeForGuest()`, `frameFor()`, `redactForGuest()`, `redactDesk()`, dan
field `redacted` di setiap payload. Tidak ada satu pun yang ditinggalkan dalam
keadaan tidak terpakai: redaktor yang menganggur adalah undangan untuk
memasang kembali principal kedua tanpa ada yang mengulang analisis ancaman.

Gerbang yang menjaga ini: `scripts/check-live.sh` §2–4 menegaskan terhadap
situs yang sedang berjalan bahwa `GET /` tidak mencetak cookie dan bahwa
`/policy`, `/roster`, `/presence` menjawab 401 tanpa sesi.

§6 (aktivitas) membaca `/presence` untuk membuktikan ada agen yang benar-benar
mengirim. `/presence` dipasang `requireAny`: ia menolak pemanggil anonim
dengan 401, tetapi menerima **ketiga** token — owner, cloud, maupun mac.
Bukan owner-only; catatan sebelumnya di baris ini keliru menyebut begitu,
padahal petunjuk di gerbangnya sendiri sudah benar. Diuji terhadap server:
owner 200, cloud 200, mac 200, token asal 401, tanpa token 401.

Gerbang memakai `OFFICE_LIVE_TOKEN` bila disuplai — tanpa token, ia melaporkan
"presence not checked" secara jujur, bukan hijau palsu. Token mana pun dari
ketiganya cukup; pakai yang paling sempit yang Anda punya, bukan token owner,
karena gerbang ini hanya perlu membaca.

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
- Validasi event (lihat EVENTS.md §5) berlaku sebelum persist & broadcast — dua lapis
- Log tidak memuat body request penuh (hanya meta: type, source, size)
- GitHub token office-server: pakai token cloud yang sudah ada via env, scope read-only public+privat metadata (tidak write)

### Nilai token tidak boleh masuk git — termasuk pesan commit

Pohon berkas sudah dijaga `.gitignore`, tapi **pesan commit tidak dijaga apa
pun**. Pernah terjadi: potongan nilai `OFFICE_TOKEN` dan `OFFICE_CLOUD_TOKEN`
ditempel ke badan pesan commit saat menjelaskan perubahan konfigurasi, dan
potongan itu langsung permanen di riwayat publik.

Kalau perlu menjelaskan konfigurasi di pesan commit, sebut **nama variabelnya
saja** — "`OFFICE_CLOUD_TOKEN` kini dibaca dari `EnvironmentFile`" — tanpa
nilai, tanpa awalan, tanpa potongan.

Hal yang sama berlaku untuk unit systemd: jangan pakai `Environment=` untuk
kredensial, karena `systemctl --user cat` akan membeberkannya. Pakai
`EnvironmentFile=` yang berisi berkas mode 0600.

### Rotasi token

Ketiga token sumber (`OWNER`, `CLOUD`, `MAC`) adalah 32 karakter heksadesimal
dan bisa diputar kapan saja tanpa migrasi data — tidak ada yang menyimpan
turunannya.

```bash
openssl rand -hex 16                      # satu token baru
# perbarui nilainya di .env.office milik server kantor
# perbarui OFFICE_TOKEN di ~/.hermes/.env milik denyut (pakai nilai CLOUD)
systemctl --user restart hermes-office.service hermes-denyut.service
```

Verifikasi sesudahnya, dan **jangan berhenti di `is-active`** — unit yang
mengirim 401 terus-menerus tetap tampak aktif:

```bash
source ~/.hermes/.env
curl -s -H "Authorization: Bearer $OFFICE_CLOUD_TOKEN" \
  "$OFFICE_URL/presence" | python3 -m json.tool | grep -A2 cloud
```

Rotasi memutus setiap klien yang masih memegang nilai lama — relay Mac dan
hook cloud ikut ditolak 401 sampai nilainya diperbarui di sisi mereka. Itu
perilaku yang benar, bukan kerusakan, tapi perbarui semuanya dalam satu
sesi supaya tidak ada agen yang membeku luring tanpa ketahuan.

Pemeriksaan tanpa kredensial, berguna saat Anda tidak memegang token: `GET
/health` terbuka dan memuat `eventsBuffered`. Angka yang **naik** di dua
sampel berjarak satu menit membuktikan ada pengirim aktif dengan kredensial
yang sah, tanpa perlu membuka `/presence`.

## 7. Transport

- Wajib HTTPS/WSS di produksi (proxy platform)
- HSTS disarankan di level proxy
- Tailscale path (opsi C) aman via WireGuard, boleh HTTP lokal

## 8. Anti-Abuse Agent Loop

Chat `@mac` → A2A:
- Hard cap 1 turn (default), configurable max 3
- Cooldown 60s per context
- Balasan Mac di-sanitize (escape, clamp panjang) sebelum ditampilkan

## 9. Data Retention & Privacy

| Data | Retensi |
|---|---|
| events ring buffer | 7 hari / 100k baris |
| chat history | permanen (kecil), bisa dihapus owner via panel |
| backup DB | 14 hari lokal |

Tidak ada telemetry eksternal. Tidak ada data yang keluar dari server kecuali ke browser pemilik yang terautentikasi.

## 9a. Jejak audit (Fase 4)

`GET /ledger*` dan `GET /dossier` adalah **owner-only, tanpa kecuali** —
termasuk tertutup untuk token **bridge**. Ledger adalah satu-satunya tempat
semua fakta yang dulu diredaksi dari tamu tertulis lengkap dan berdampingan:
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
pengeluaran per jam serta denah privilese lengkap ke token tamu. Terdeteksi
saat audit pra-fase, bukan oleh test — karena tidak ada test yang menanyakannya.
Pelajaran yang sudah dikodekan: **setiap endpoint baru wajib punya baris di tabel
§3 dan satu test otorisasi sebelum dianggap selesai.**

## 10. Checklist rilis

- [ ] Semua token baru dirotasi saat go-live pertama
- [ ] validateEvent test green untuk semua event type
- [ ] Rate limit test (burst) green
- [ ] Logger test: tempel token fake di task summary → muncul [REDACTED] di log
- [ ] WS origin: koneksi dari origin asing ditolak
- [ ] Tanpa sesi tidak bisa POST /chat (401)

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

**Yang dianggap kerentanan di sini.** Membaca data apa pun tanpa sesi (§3), kebocoran
token lewat jalur mana pun termasuk pipeline redaksi (§6), pemalsuan rantai
ledger yang lolos `verify()`, RCE, dan eskalasi dari `bridge` ke
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
