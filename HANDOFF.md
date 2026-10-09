# Serah-terima — `hermes-office-v2` → branch `dev` repo asli

Dokumen ini untuk agen Hermes yang akan menerapkan fork ini, dan untuk
pemiliknya. Dibaca dari atas ke bawah, lalu dieksekusi.

Bahasa: dokumen operasional ini Indonesia. `AGENTS.md` sengaja Inggris —
ia aturan produk yang akan dibaca kontributor dan agen mana pun nanti,
sejalan dengan komentar skrip di repo.

---

## 1. Yang pertama dijalankan, sebelum apa pun

```bash
bash scripts/check-handoff.sh
```

Harus mencetak:

```
PASS: 561 files match MANIFEST.sha256 byte-for-byte; no extras; asset counts intact
```

**Kalau ini merah, berhenti.** Jangan baca kode, jangan jalankan tes, jangan
perbaiki apa pun. Pohon yang bukan dirinya sendiri akan menggagalkan gerbang
lain karena alasan yang tidak nyata, dan Anda akan menghabiskan sore hari
mengejar hantu.

Alasan skrip ini ada: selama fork ini dibangun, snapshot workspace
**sembilan kali** menjatuhkan berkas tanpa suara — `node_modules` 2×, 36
berkas top-level `art/originals/sprites` 3×, `.github/workflows/ci.yml` 2×,
`SPRITES.json` mundur ke revisi lama 1×, dan ~25 MB render sumber hilang
permanen. Tidak satu pun mengumumkan diri. Transfer antar-mesin adalah
bentuk kegagalan yang sama dengan lebih banyak kesempatan.

Kalau gagal pada `art/originals/sprites holds 64, expected 100` — itu
kegagalan yang paling sering terjadi, dan pemulihannya ada di §6.

---

## 2. Lalu buktikan hijau

```bash
bash scripts/verify.sh
```

Patokan yang harus direproduksi (per 2026-10-08):

| Gerbang | Hasil |
|---|---|
| handoff integrity | 562 berkas cocok |
| eslint | 0 masalah |
| frontend build | ~215 kB JS / 42,50 kB CSS (vite 8) |
| backend tests | **305** lulus, 0 gagal |
| frontend tests | **129** lulus |
| clean shutdown | keluar bersih dengan WebSocket hidup |
| upstream assets | 258 aset terhitung |
| ci workflow | cocok dengan `ci/workflow.yml` |
| deployable | tak ada ikatan host/akun |
| room plates | 18 plate, hash + 7 aturan gaya |
| doc claims | **87** klaim cocok |
| sprites (+rebuild) | **282** sprite, 132 bangun ulang byte-exact |

`verify.sh` memutuskan lulus/gagal **hanya dari exit code**, tidak pernah
dari grep keluaran. Versi sebelumnya sempat melaporkan "lint bersih" di atas
dua error eslint nyata, karena `tail` selalu keluar 0.

Butuh cepat: `bash scripts/verify.sh --fast` (~1 menit, melewati rebuild
sprite byte-exact).

---

## 3. Cara menerapkan ke branch `dev`

### Jalur yang dianjurkan: arsip tunggal

Transfer per-berkas adalah bentuk kegagalan yang menjatuhkan 36 berkas tiga
kali di sini. Arsip tunggal menghapus kelas itu — ia tiba utuh atau tidak
tiba sama sekali.

```bash
# dijalankan DARI direktori yang memuat arsipnya — berkas .sha256 menyimpan
# nama telanjang, jadi dari direktori lain ia gagal "No such file"
cd /direktori/berisi/arsip
sha256sum -c hermes-office-v2.tar.gz.sha256

tar xzf hermes-office-v2.tar.gz
cd hermes-office-v2
bash scripts/check-handoff.sh
```

Diuji bolak-balik sebelum dikirim: arsip diekstrak ke direktori kosong,
tanpa `node_modules` dan tanpa `dist`, lalu `verify.sh` dijalankan dari nol
— **12/12 gerbang hijau.** Jadi kalau di sisi Anda merah, perbedaannya ada
di lingkungan, bukan di isi arsip, dan itu informasi yang berguna. Kirim
keluaran mentahnya.


Fork ini **bukan** repo git — ia pohon berkas murni, sengaja, supaya tidak
membawa riwayat palsu ke repo asli. Terapkan sebagai satu lapisan:

```bash
cd /path/ke/hermes-office-asli
git checkout -b dev            # atau: git checkout dev

# salin pohon, tanpa artefak turunan
rsync -a --delete \
  --exclude node_modules --exclude frontend/node_modules \
  --exclude dist --exclude frontend/dist \
  --exclude data --exclude .git \
  /path/ke/hermes-office-v2/ ./

# tanpa rsync (mis. container minimal): arsipnya sudah tidak memuat
# artefak turunan, jadi ekstrak langsung sudah setara
#   tar xzf hermes-office-v2.tar.gz --strip-components=1 -C .

bash scripts/check-handoff.sh   # harus PASS di lokasi baru juga
bash scripts/verify.sh
git add -A && git commit -m "v2: fase 0-21 (lihat CHANGELOG-v2.md)"
```

`--delete` disengaja: fork ini adalah keadaan yang dimaksud, bukan tambalan
di atas yang lama. Kalau Anda ingin menahan sesuatu dari branch asli,
putuskan **sebelum** menjalankannya.

Catatan: `MANIFEST.sha256` dibuat relatif terhadap akar pohon, jadi ia tetap
sah setelah dipindah selama isinya tidak berubah.

---

## 4. Dua keputusan yang sengaja TIDAK saya ambil

Keduanya mengubah produk secara permanen, jadi bukan milik saya.

### 4a. 150 sprite cast lama — hapus atau simpan?

Status sekarang: **dikirim, tapi tidak dirender oleh apa pun.** `grep` ke
`frontend/src` mengembalikan nol rujukan ke `office/characters` maupun
`characters/`. Aplikasi memakai 8 arketipe donghua di `sprites/donghua/`.

- **Menyimpan** = jalur mundur satu baris (satu path di `Character.tsx`),
  tapi 150 berkas bobot mati **dan** paparan HKI: 108 di antaranya adalah
  rupa yang dapat dikenali dari sebuah serial televisi, di dalam produk
  berharga $2.000+.
- **Menghapus** = paparan tertutup, build mengecil, keputusan seni terkunci.

Kalau dihapus, yang ikut berubah: `check-sprites.py --write`,
`docs/SPRITES.md` (tabel provenance + bagian "150 sprite cast lama"),
`check-docs.py` (ekspektasi `unsourced` 150 dan `office/characters` 108),
dan angka 282 di 5 dokumen. Semuanya akan **gagal keras** lebih dulu — itu
memang desainnya.

### 4b. `art/` (5,2 MB) — tetap di repo?

Rekomendasi saya: **ya, tetap.** Itu input yang membuat 132 sprite
reproducible, dan memindahkannya keluar repo adalah persis cacat yang
pernah menghancurkan seninya (pipeline membaca path absolut yang hanya ada
di satu mesin, lalu memfilter ulang hasil filternya sendiri sambil mencetak
`originals preserved`).

---

## 5. Yang belum dikerjakan

| Item | Catatan |
|---|---|
| R5 — Durable Objects | butuh akun Cloudflare, belum ada |
| R6 — marketplace | belum dimulai |
| Niu-mode stub | belum dimulai |
| 8 `setTimeout` tetap di `integration.test.js` | belum terbukti flaky (bertahan 5 larian suite penuh dengan 2 inti jenuh), tapi sebentuk dengan dua yang sudah diperbaiki. Ubah hanya kalau ada bukti yang menuntutnya. |
| `mac-studio-day` | dinding bergradasi pink→hijau, cacat diketahui, regenerasi belum dikerjakan |

---

## 6. Pemulihan darurat

Jaring pengaman ada di **luar** repo, di mesin tempat fork ini dibangun:

```
/home/user/art-backup/sprites/   100 webp — sumber sah `derived`
/home/user/art-backup/rooms/     12 placeholder + 4 office-* asli
```

Kalau `art/originals/sprites` kurang dari 100:

```bash
cp -rn /home/user/art-backup/sprites/* art/originals/sprites/
find art/originals/sprites -name '*.webp' | wc -l    # harus 100
```

Kalau `.github/workflows/ci.yml` hilang: `bash scripts/install-ci.sh`
Kalau `SPRITES.json` mundur: `python3 scripts/check-sprites.py --write`,
lalu **wajib** `python3 scripts/check-sprites.py --regen` untuk membuktikan
seni di disk belum rusak sebelum manifest baru dipercaya.

Setelah pemulihan apa pun yang disengaja:
`bash scripts/check-handoff.sh --write`

---

## 7. Komunikasi dua arah

Lihat `handoff/LOG.md`. Satu berkas, append-only, dua arah. Formatnya ada di
kepala berkas itu.

Aturan yang membuatnya berguna, bukan seremonial:

1. **Setiap entri membawa keluaran `verify.sh`**, bukan ringkasan. "Semua
   lulus" tidak bisa diperiksa; daftar gerbang bisa.
2. **Entri yang melaporkan perbaikan membawa mutasinya** — apa yang Anda
   rusak untuk membuktikan gerbangnya menyala.
3. **Jangan ubah entri lama.** Koreksi adalah entri baru yang menunjuk ke
   entri lama. Riwayat yang bisa disunting bukan riwayat.
4. Ketidakpastian ditulis sebagai ketidakpastian. Fase 18 dan 21 di
   `CHANGELOG-v2.md` hampir seluruh nilainya datang dari membatalkan
   diagnosis yang salah — itu hanya mungkin kalau diagnosis awalnya
   dicatat apa adanya.

---

## 8. Peta cepat isi repo

| Jalur | Isi |
|---|---|
| `AGENTS.md` | aturan untuk siapa pun yang menyunting repo — baca sebelum README |
| `CHANGELOG-v2.md` | 2858 baris, Fase 0–21, alasan di balik setiap keputusan |
| `docs/ARCHITECTURE.md` · `PRD.md` · `UI-SPEC.md` | spesifikasi, semuanya diperiksa mesin |
| `docs/SPRITES.md` · `ROOM-PLATES.md` | provenance aset + apa yang menangkap apa |
| `docs/PRICING.md` · `.id.md` | halaman harga, angkanya kini ikut diperiksa |
| `scripts/verify.sh` | satu perintah, 12 gerbang |
| `scripts/check-handoff.sh` | integritas transfer |
| `MANIFEST.sha256` | 561 berkas, sha256 |
| `art/originals/sprites/` | 100 original — **jangan pernah ditimpa** |
| `art/donghua-cast/` | 16 render — sumber 32 sprite `built` |
