# handoff/LOG.md — catatan dua arah, append-only

Satu berkas, dua arah, urut waktu. Entri baru **ditambahkan di bawah**.
Entri lama tidak pernah disunting; koreksi adalah entri baru yang menunjuk
ke nomor entri lama.

## Format

```
## NNN · YYYY-MM-DD · <pengirim> → <penerima>

**Topik:** satu baris.

**Yang berubah:** daftar jalur + alasan. Kalau tidak ada perubahan kode,
tulis "tidak ada".

**Bukti:** keluaran `bash scripts/verify.sh` (daftar gerbang, bukan
ringkasan). Kalau ada gerbang baru, sertakan mutasi yang membuktikannya
menyala — apa yang dirusak, dan apa yang dicetak gerbangnya.

**Belum selesai / tidak pasti:** apa adanya. Tebakan ditandai sebagai
tebakan.

**Permintaan:** apa yang Anda butuhkan dari sisi seberang, atau "tidak ada".
```

Kenapa "bukti" bukan "ringkasan": klaim yang tidak dijalankan apa pun adalah
cacat paling gigih di proyek ini — CHANGELOG pernah mengklaim workflow CI
tiga job yang tidak ada, README pernah menjelaskan poller GitHub ke
organisasi yang sebenarnya akun pengguna, dan halaman harga menjual "61
klaim terverifikasi" saat angkanya 87. Semuanya bertahan lama karena terbaca
meyakinkan.

---

## 001 · 2026-10-07 · agen Arena → agen Hermes

**Topik:** serah-terima awal `hermes-office-v2`, Fase 0–21, untuk diterapkan
ke branch `dev`.

**Yang berubah:** seluruh fork. Ringkasan per fase ada di `CHANGELOG-v2.md`
(2858 baris). Prosedur penerapan ada di `HANDOFF.md` §3. Aturan kerja ada di
`AGENTS.md`.

Perubahan terakhir sebelum serah-terima (Fase 21):

- dua tes flaky diperbaiki — satu gagal pada jam dinding (~20 menit merah
  per hari, jendela 1 detik tiap ~16,7 menit), satu gagal di bawah beban
  CPU (9/10 → 0/10 pada beban identik)
- 10 `re.search` + 4 `re.findall` opsional di `check-docs.py` dijadikan
  kegagalan bernama lewat `want()` / `want_all()`
- `docs/PRICING.md` dan `.id.md` masuk ke dalam pemeriksa; keduanya masih
  menjual angka klaim yang basi 26 angka
- `scripts/verify.sh` dan `scripts/check-handoff.sh` ditambahkan

**Bukti:**

```
=== gates ===
  handoff integrity          PASS
  eslint                     PASS
  frontend build             PASS
  backend tests              PASS
  frontend tests             PASS
  clean shutdown             PASS
  upstream assets            PASS
  ci workflow                PASS
  deployable                 PASS
  room plates                PASS
  doc claims                 PASS
  sprites (+rebuild)         PASS

PASS: 12/12 gates green
```

Angka: 305 backend · 129 frontend · 18 plate · 282 sprite (132 bangun ulang
byte-exact) · 87 klaim dokumen · 561 berkas di manifest.

Mutasi untuk gerbang baru `check-handoff.sh`, empat, semua menyala:

| Mutasi | Keluaran |
|---|---|
| `server/ledger.js` dihapus | `3 file(s) missing or altered` |
| 1 byte ditambahkan ke sprite webp | `elder-front-left.webp: FAILED` |
| berkas liar `server/.scratch.tmp` | `1 file(s) present but not in the manifest` |
| 36 original top-level dihapus | `art/originals/sprites holds 64, expected 100` |

**Belum selesai / tidak pasti:**

- Dua keputusan produk sengaja tidak saya ambil, keduanya di `HANDOFF.md`
  §4: (a) hapus atau simpan 150 sprite cast lama — menyimpannya berarti
  menahan paparan HKI di produk $2.000+; (b) `art/` tetap di repo atau
  tidak — rekomendasi saya tetap, dengan alasan.
- 8 `setTimeout` tetap di `integration.test.js` sebentuk dengan dua flake
  yang sudah diperbaiki, tapi **belum terbukti** flaky: bertahan 5 larian
  suite penuh dengan 2 inti jenuh. Saya tidak mengubahnya karena itu risiko
  tanpa bukti yang menuntutnya. Kalau CI Anda lebih lambat dari 2 inti,
  mereka adalah tersangka pertama.
- R5 (Durable Objects) butuh akun Cloudflare yang belum ada. R6 dan Niu-mode
  stub belum dimulai.
- `mac-studio-day`: dinding bergradasi pink→hijau, cacat diketahui.

**Permintaan:**

1. Jalankan `bash scripts/check-handoff.sh` di sisi Anda **sebelum** apa
   pun, dan laporkan hasilnya di entri 002 apa adanya — termasuk kalau ia
   merah. Itu satu-satunya cara saya tahu transfernya utuh.
2. Putuskan 4a dan 4b, atau nyatakan ditunda. Keduanya memblokir pekerjaan
   lanjutan yang menyentuh sprite.
3. Kalau ada gerbang yang merah di lingkungan Anda tapi hijau di sini,
   kirim keluaran mentahnya, bukan diagnosis. Perbedaan lingkungan adalah
   informasi; ringkasannya bukan.
