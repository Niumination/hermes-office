# Standup — bacaan pagi (Fase 14)

`GET /standup` — ringkasan pendek, berperingkat, dan berpendapat tentang apa
yang dilakukan armada sejak kemarin. Owner saja.

Ia menjawab satu pertanyaan: **"Apa saya perlu melakukan sesuatu hari ini?"**

## Mengapa ia bukan dossier yang dipendekkan

Keduanya sengaja berlawanan:

| | dossier (Fase 4) | standup (Fase 14) |
|---|---|---|
| pembaca | auditor yang **tidak** memercayai Anda | operator yang sudah percaya, punya 4 menit |
| isi | lengkap, netral, menarasikan tiap catatan | lossy, berperingkat, berpendapat |
| panjang | kebajikan | **cacat** |

Keduanya tidak boleh bertemu di tengah. Kalau ada yang minta "sedikit lebih
detail" di standup, jawabannya adalah tautan ke dossier — yang sudah ada.

## Aturan yang membuatnya layak dibaca

**Standup yang selalu punya sesuatu untuk dikatakan adalah kebisingan.**

Setiap laporan harian otomatis mati dengan cara yang sama: ia memadatkan
ruang kosong. Ia mencetak "Penolakan: 0. Izin: 0. Semua normal." setiap pagi
sampai orang memfilternya ke folder yang tak pernah dibuka — lalu ia tidak
berguna pada satu-satunya pagi yang penting.

Maka:

- Temuan harus melewati ambang keparahan untuk dicetak sama sekali.
- Bagian kosong **dihilangkan**, tidak pernah dirender sebagai "Tidak ada".
- Malam yang tenang menghasilkan **satu baris**, dan itu keberhasilan, bukan
  kekurangan.

```
HERMES OFFICE — STANDUP 2026-10-06 06:38Z (24 jam terakhir)
============================================================

Tidak ada yang membutuhkan Anda.

2 catatan · 0 keputusan · 0 penolakan · status tertinggi: normal
Rantai: utuh · 2 catatan · jangkar: none
```

Satu-satunya yang selalu dicetak adalah integritas rantai, karena diam
tentang log audit tidak bisa dibedakan dari log audit yang hilang.

## Tanpa panggilan model. Selamanya.

Ini templating deterministik. Rentang ledger yang sama → teks identik
byte-per-byte. Tiga alasan, makin ke bawah makin penting:

1. Gratis, dan tidak bisa kena rate-limit pukul 09:00.
2. Ia tidak bisa berhalusinasi tentang penolakan yang tak pernah terjadi.
   Laporan tata kelola yang mengarang insiden lebih buruk daripada tidak ada
   laporan.
3. Produk yang tesisnya "agent menghabiskan uang sungguhan dan butuh pagar"
   tidak boleh membakar token untuk memberi tahu Anda berapa token yang Anda
   bakar. Memasang LLM di sini berarti produk ini menggugurkan argumennya
   sendiri di depan umum.

Efek sampingnya: standup bisa dihitung ulang oleh auditor dari rantai yang
sama dan menghasilkan teks yang sama persis.

## Yang tidak bisa diketahui rantai

Tidak ada biaya terealisasi per panggilan di ledger. Event biaya masuk ke
burn tracker, bukan ke rantai. Yang dipegang rantai hanya:

- `budget_transition.spentUsd` — belanja sejauh ini **di dalam jendela
  anggaran itu**, pada saat transisi. Puncak, bukan total.
- `policy_decision.estimatedUsd` — perkiraan **pra-eksekusi** untuk tindakan
  yang mungkin ditolak dan mungkin tidak pernah berjalan.

Jadi berkas ini tidak pernah mencetak "total belanja kemarin". Ia mencetak
puncak, dan melabeli perkiraan sebagai perkiraan. Menjumlahkan field itu akan
menghasilkan angka yang percaya diri, salah, dan terekam permanen — artefak
terburuk yang bisa dikeluarkan basis kode ini. Ada test khusus yang mencoba
menjumlahkannya dan harus gagal.

## Temuan yang bisa muncul

| id | keparahan | kapan |
|---|---|---|
| `chain-truncated` / `chain-bad` | KRITIS | rantai terpotong atau verifikasi gagal |
| `approvals-expired` | PERLU TINDAKAN | izin kedaluwarsa tanpa jawaban |
| `approvals-pending` | PERLU TINDAKAN | ada izin menunggu sekarang |
| `budget-tripped` | PERLU TINDAKAN | batas tercapai, tindakan ditolak |
| `repeat-denials` | PERLU TINDAKAN | agent+alat sama ditolak ≥3× |
| `spend-up` | PERLU TINDAKAN | perkiraan beban ≥2× periode sebelumnya |
| `agents-quiet` | CATATAN | aktif kemarin (≥5 catatan), nol hari ini |
| `agents-new` | CATATAN | agent baru pada armada mapan |
| `approval-latency` | CATATAN | median tunggu izin, ≥3 sampel |

Dua yang paling berharga, dan keduanya tak terlihat di tempat lain:

**`approvals-expired`** — agent meminta izin, TTL habis, tidak ada manusia
yang datang. Itu bukan kegagalan teknis, itu masalah organisasi, dan
pekerjaannya berhenti diam-diam.

**`repeat-denials`** — agent yang sama ditolak untuk alat yang sama sepuluh
kali hampir tidak pernah penyusup. Itu loop: agent mencoba, ditolak, mencoba
lagi. Ambangnya 3, dan penolakan yang tersebar ke alat berbeda **tidak**
dijumlahkan jadi alarm palsu — itu cuma hari yang sibuk.

## Perbandingan periode

Jendela sebelumnya yang sama panjang selalu ikut dimuat. Angka tanpa
pembanding adalah trivia; "3,2× kemarin" adalah keputusan.

Ini juga satu-satunya cara membedakan agent yang mati dari agent yang
menganggur: keduanya menghasilkan nol event. Hanya periode sebelumnya yang
tahu bedanya.

## Pemakaian

```
GET /standup                 → text/plain  (terminal, cron mail, Slack)
GET /standup?format=md       → markdown    (tiket, Slack berformat)
GET /standup?format=json     → model mentah
GET /standup?hours=72        → jendela lain (1–168 jam)
```

Teks polos tanpa warna dan tanpa gambar kotak: ia harus selamat di cron mail,
di ponsel pukul 07.40, dan di dalam blok kode Slack. Ada test yang menolak
kode ANSI dan karakter box-drawing.

Kirim ke Slack tiap pagi:

```bash
TEXT=$(curl -s -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" \
  https://office.example.com/standup)
curl -s -X POST -H 'content-type: application/json' \
  -d "$(jq -Rn --arg t "$TEXT" '{text:("```"+$t+"```")}')" "$SLACK_WEBHOOK"
```

Perhatikan bahwa ini mengirim angka dolar ke Slack. Itu keputusan Anda, bukan
default kami — karena itu tidak ada webhook bawaan di sini.

## Tidak direkam ke ledger

Dossier merekam ekspornya sendiri, karena "siapa yang membaca log audit"
adalah pertanyaan auditor. Standup tidak. Laporan yang ditarik cron setiap
pagi akan mengubur rantai dalam referensi-diri: ribuan catatan tentang
pembacaan catatan.
