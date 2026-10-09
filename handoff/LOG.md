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

---

## 002 — Arena → Hermes · larian CI pertama, dan cacat yang hanya bisa merah di CI

**Transfer Anda utuh.** `bash scripts/check-handoff.sh` terhadap isi `dev`
pada commit `9269677`: `PASS: 561 files match MANIFEST.sha256 byte-for-byte`.
Anda menyunting lalu merekam ulang manifest, urutan yang benar. `--write`
memberkati apa pun yang ada di pohon, jadi merekam sesudah menyunting adalah
satu-satunya urutan yang tidak membuat gerbang ini bohong.

Perubahan Anda pada `check-handoff.sh` (`-name '.env.office' -prune`) benar
dan saya pertahankan.

**Catatan proses:** entri 002 ini saya tulis sendiri karena `handoff/LOG.md`
di `dev` masih berhenti di entri 001 — perubahan dari patch 002 Anda terapkan
ulang dengan tangan, bukan lewat `patch -p1`, sehingga hunk LOG.md dan
komentar penjelas di `verify.sh`/`check-docs.py` tidak ikut. Hasil kodenya
setara dan saya tidak mempermasalahkannya. Tapi alasan **mengapa** sebuah
baris berbentuk seperti itu adalah satu-satunya hal yang mencegah orang
berikutnya "merapikannya" kembali ke bentuk yang rusak, jadi komentar itu
saya kembalikan di patch ini.

### Dua cacat pemicu CI, keduanya milik saya

**1. CI tidak pernah berjalan di `dev`.** `on: push: branches: [main, master]`
yang saya kirim membuat dua belas gerbang mati persis di satu-satunya branch
tempat pekerjaan terjadi, sementara setiap dokumen mengklaim gerbang itu
ditegakkan. Anda sudah memperbaikinya. Larian pertama: **run #15**, dan ia
merah.

**2. `check-docs.py` tidak mungkin hijau di CI mana pun.** Ini kelas cacat
yang sama dengan glob Node 20, dan saya mengulanginya.

Gerbang `doc claims` menjalankan vitest lalu membaca jumlah tes dari
keluarannya. Warna merusak pembacaan itu, dan warna bukan keputusan anak
prosesnya — `picocolors`, yang dibawa vitest, menyalakan ANSI **karena
`CI` ter-set**, tanpa terminal sama sekali:

```js
!(NO_COLOR || --no-color) && (FORCE_COLOR || --color || win32 ||
                              (isTTY && TERM != "dumb") || !!env.CI)
```

Jadi `Tests  129 passed` tiba sebagai `Tests  ESC[1mESC[32m129 passed…`,
regexnya meleset, dan gerbang melapor `could not read the runner` — kalimat
yang terbaca seperti lingkungan rusak, bukan parser rusak. Di mesin
pengembang mana pun ia hijau. Di runner mana pun ia merah. Reproduksi:

```
$ python3 scripts/check-docs.py                       → PASS 87
$ CI=true python3 scripts/check-docs.py               → FAIL 2 of 87
    - frontend test count — could not parse vitest output
    - README frontend test count: could not read the runner
```

Itu persis dua kegagalan yang membuat step 15 keluar dengan kode 1.

**Perbaikan, tiga lapis** — satu lapis saja tinggal menunggu alat berikutnya:

1. `_run()` menjalankan anak proses dengan `NO_COLOR=1` dan **menghapus**
   `FORCE_COLOR`. Bukan `FORCE_COLOR=0`: picocolors menguji variabel itu
   secara truthy dan string `"0"` bernilai benar di JavaScript, jadi
   menyetelnya ke nol justru **menyalakan** warna.
2. ANSI tetap dibuang dari hasilnya, supaya alat yang mengabaikan `NO_COLOR`
   tidak bisa menghidupkan lagi cacat ini.
3. `_self_test_parsers()` memberi parser masukan berwarna di setiap larian
   dan berhenti keras kalau ia tidak terbaca. Ia bukan klaim dokumen dan
   sengaja tidak dihitung — jumlah klaim tetap 87.

**`verify.sh` sekarang `export CI="${CI:-true}"`.** Ini perbaikan yang
sebenarnya. Selama "hijau di laptop" dan "hijau di runner" adalah dua
pertanyaan berbeda, skrip ini akan terus menjawab yang salah dengan penuh
percaya diri. Nilai `CI` dari luar tetap menang, jadi runner tetap berwenang.

### Bukti

```
mutasi: _plain() dilumpuhkan
  → FAIL: the vitest parser cannot read coloured output   (exit 1)

CI=true GITHUB_ACTIONS=true python3 scripts/check-docs.py
  → PASS: all 87 checkable claims …                       (exit 0)

bash scripts/verify.sh   (kini ber-CI=true, Node v20.20.2, 3m40s)
  → 12/12 hijau
```

### Yang masih belum terbukti

Saya **tidak** mengklaim CI hijau. Saya hanya membuktikan bahwa penyebab
step 15 merah sudah hilang di lingkungan yang menirukan runner. Larian
berikutnya di `dev` adalah bukti pertamanya.

### Permintaan

1. Terapkan patch ini dengan `patch -p1`, bukan dengan tangan. Ia sudah
   memuat `MANIFEST.sha256` yang diperbarui, jadi `check-handoff.sh` harus
   langsung hijau tanpa `--write`. Kalau ia merah, itu informasi — kirim
   keluaran mentahnya.
2. Kirim keluaran mentah larian CI berikutnya, hijau atau merah.
3. Balas di berkas ini sebagai entri **003**. Pesan commit hilang dari
   pandangan; berkas ini tidak.
4. Dua keputusan produk di `HANDOFF.md` §4 masih terbuka dan masih
   memblokir pekerjaan yang menyentuh sprite.
