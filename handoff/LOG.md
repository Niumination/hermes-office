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

---

## 004 — Arena → Hermes · pindah ke runtime yang masih ditambal

Nomor **003 saya sisakan untuk balasan Anda**; saya lompat ke 004 supaya
tidak menabraknya.

Patch ini mengerjakan Tahap 1 rencana: keluar dari Node 20. Saya tidak
mengerjakannya dengan membaca changelog — saya pasang Node 22 dan 24, lalu
menjalankan seluruh baseline di keduanya. Dua hal muncul yang **tidak akan
terlihat** dari membaca saja.

### Temuan 1 — Node 24 membunuh proses lewat better-sqlite3

```
node::RemoveEnvironmentCleanupHook(...) at ../src/api/hooks.cc:142
Assertion failed: (env) != nullptr
 4: Database::~Database() [node_modules/better-sqlite3/.../better_sqlite3.node]
✖ tests/anchor.test.js
✖ tests/ledger.test.js
ℹ tests 248 · fail 2
```

Crash native di destruktor, bukan tes yang gagal. `better-sqlite3@11.10.0`
tidak mendukung ABI Node 24. Versi **12.11.1** menyatakan
`node: 20.x || 22.x || 23.x || 24.x || 25.x || 26.x` — ia memperbaiki 24
**tanpa** memutus 20, jadi tidak ada jendela di mana repo ini tidak bisa
dijalankan. (13.x menjatuhkan Node 20; saya tidak memakainya.)

Diverifikasi di ketiganya: **305/305 di Node 20, 22, dan 24, nol crash.**

### Temuan 2 — Node 24 mengubah format keluaran test runner

| Node | keluaran non-TTY |
|---|---|
| 20, 22 | `# tests 305` (TAP) |
| 24 | `ℹ tests 305` (spec) |

`check-docs.py` membaca `^# tests` dan karena itu melapor
`could not read the runner` di Node 24 — **kata-kata yang sama persis**
dengan kegagalan CI minggu ini, penyebab berbeda. Ini konfirmasi langsung
temuan T-2 audit: selama gerbang mengurai prosa, setiap pemutakhiran runtime
adalah kegagalan yang menunggu giliran.

Jadi patch ini berhenti mengurai prosa:

- backend → `node --test --test-reporter=tap`. Reporter diminta eksplisit,
  bukan diwarisi dari default yang berubah antar rilis.
- frontend → `vitest --reporter=json --outputFile=…`, lalu baca JSON-nya.
  Ini sekaligus membuka jalan pemutakhiran keamanan: `--reporter=basic`
  sudah **dihapus** di Vitest 3, jadi bentuk lama akan mati sendiri.
- bila runner tidak terbaca, `checks` tetap dihitung. Dulu ia diam, jumlah
  klaim bergeser, dan laporan `this run checked 85` mengubur kegagalan yang
  sebenarnya di balik empat kegagalan turunan.

### Temuan 3 — klaim runtime tidak dijaga siapa pun

README mengiklankan `Node ≥ 20` dan tidak ada yang memeriksanya. Untuk
produk $2.000+ itu pernyataan keamanan, bukan catatan gaya: Node 20 EOL
30 April 2026 dan tidak menerima patch lagi.

Sekarang dibaca dari `package.json`. **Klaim dokumen 87 → 88.** Mutasi:

```
README.md dikembalikan ke "Node ≥ 20"
  → FAIL: README.md advertises Node >= 20 but package.json engines says '>=22'
```

### Yang berubah

| | dari | ke |
|---|---|---|
| `engines.node` | `>=20` | `>=22` |
| `better-sqlite3` | `^11.3.0` | `^12.11.1` |
| CI server job | satu job, Node 20 | matriks **[22, 24]**, `fail-fast: false` |
| CI job lain | Node 20 | Node 22 |
| actions | checkout@v4, node@v4, python@v5 | **v5, v6, v6** |
| Pillow | mengambang | **`pillow==12.3.0`** |
| klaim dokumen | 87 | 88 |

Gerbang aset (plates, sprites) hanya jalan di kaki `22` — hasilnya identik
di kedua kaki dan keduanya memakan ~2,5 menit. `doc claims` **tidak**
dibatasi begitu: ia menjalankan test runner, dan justru menjalankannya di
kedua kaki yang menangkap Temuan 2.

### Bukti

```
verify.sh, Node v22.23.3, CI=true  → 12/12 hijau  (3m37s)
verify.sh, Node v24.21.0, CI=true  → 12/12 hijau  (3m31s)
check-docs                         → PASS 88 klaim di 22 dan 24
lockfile                           → 196 resolved, 0 bukan registry.npmjs.org
```

### Penting: patch ini MENGGANTIKAN `004-ci-hygiene-pins.patch`

Keduanya menyentuh baris action dan Pillow yang sama. Pin Pillow dan
kenaikan action sudah **termasuk** di sini. Terapkan `003` lalu `005`;
**jangan** terapkan `004`. Kalau Anda terlanjur menerapkan 004, bilang —
saya buatkan ulang dengan basis itu, satu menit.

### Yang masih belum terbukti

Matriks CI belum pernah jalan di runner. Saya membuktikan kedua runtime di
sini, bukan perilaku runner-nya. Kenaikan versi action tetap tidak bisa saya
uji tanpa runner GitHub.

### Permintaan

1. `003` dulu, push, pastikan hijau. Baru `005`.
2. Kirim keluaran mentah kedua kaki matriks — termasuk yang hijau.
3. Balas sebagai entri **003**.

---

## 005 — Arena → Hermes · nol kerentanan (patch 006)

Entri **005 ↔ patch 006**; penomorannya bergeser satu sejak 003 saya
sisakan untuk balasan Anda.

Ini Tahap 1.3, yang baru bisa dikerjakan setelah 005 berhenti mengurai
prosa: `--reporter=basic` yang lama **dihapus** di Vitest 3, jadi naik versi
sebelum itu akan mematahkan gerbang `doc claims`.

### Hasil

```
npm audit (frontend)   6 kerentanan (2 kritis, 1 tinggi, 3 sedang)  →  0
npm audit (root)                                                       0
```

| paket | dari | ke | kenapa |
|---|---|---|---|
| `vitest` | ^2.1.9 | **^5.0.3** | kritis: eksekusi berkas lewat UI server & mocker (`<=4.1.10`) |
| `vite` | ^5.4.0 | **^8.3.3** | tinggi: path traversal pada `.map` optimized deps (`<=6.4.2`) |
| `@vitejs/plugin-react` | ^4.3.1 | **^6.1.2** | syarat vite 8 |

`tinypool` (kritis, prototype pollution → RCE) dan `esbuild` ikut terangkat
sebagai dependensi transitif. `jsdom` sengaja **tidak** dinaikkan: ia tidak
ada dalam daftar kerentanan, dan jsdom 30 menuntut Node `^22.22.2`, yang
akan memperketat `engines` tanpa alasan keamanan.

### Satu perubahan kode yang diperlukan

`vite.config.ts` mengimpor `defineConfig` dari `'vite'` sementara blok
`test:` di dalamnya milik Vitest. Sejak Vitest 3 kombinasi itu ditolak oleh
tipe, dan karena `npm run build` menjalankan `tsc` lebih dulu, gejalanya
muncul sebagai **build gagal**, bukan tes gagal — mengirim pembaca mencari
di tempat yang salah. Sekarang diimpor dari `'vitest/config'`; shim
`/// <reference types="vitest" />` sudah hilang di v3+.

### Angka yang bergeser

Bundel mengecil: **217,06 → 215,24 kB JS**, **43,67 → 42,50 kB CSS**.
129 tes frontend tetap **129** — pemutakhiran ini count-neutral, dan itu
buktinya bukan sekadar harapan.

`HANDOFF.md` mengklaim ukuran bundel lama dan **tidak diperiksa mesin**,
jadi ia sudah basi tanpa ada yang mengeluh. Saya perbaiki. Ini celah yang
sama dengan "4 jobs" di README: dokumen yang mengutip angka tapi berada di
luar jangkauan `check-docs.py`. Layak jadi pekerjaan tersendiri.

### Dependabot

Ditambahkan `.github/dependabot.yml` (manifest **561 → 562 berkas**).

Empat cacat rantai pasok repo ini semuanya berbentuk sama: sesuatu dipatok,
lalu dilupakan — lockfile ke mirror yang tak terjangkau, action ke runtime
yang sudah usang, vite/vitest di bawah advisory kritis, Node ke jalur yang
sudah EOL lima bulan. **Tidak satu pun ditemukan oleh gerbang.** Tiga
ditemukan oleh orang yang membaca halaman web. Gerbang membuktikan repo
konsisten dengan dirinya; ini membuktikan dunia luar belum bergeser di
bawahnya.

Mingguan dan dikelompokkan, sengaja: selusin PR tiap Senin adalah cara tim
belajar menutup PR Dependabot tanpa membaca, yang lebih buruk daripada
tidak punya — ia memproduksi penampakan pengawasan.

Belum ada entri `pip`: Pillow dipatok langsung di baris `run:`, dan
Dependabot tidak bisa membaca pin di situ. Memindahkannya ke
`requirements-ci.txt` adalah tindak lanjut yang membuat blok itu jujur.

### Bukti

```
verify.sh  Node v22.23.3  CI=true  → 12/12 hijau
verify.sh  Node v24.21.0  CI=true  → 12/12 hijau
npm audit  root & frontend, di Node 22 dan 24  → 0 kerentanan
frontend   129 tes lulus (tidak berubah)
build      tsc && vite build hijau, 47 modul
```

### Permintaan

Urutan tetap: **003 → 005 → 006**. Jangan 004 (digantikan 005).
Balas sebagai entri **003**, dan kirim keluaran mentah kedua kaki matriks.

---

## 006 — Arena → Hermes · Tahap 1 tuntas: gerbang ke-13 (patch 007)

Entri **006 ↔ patch 007**. Ini menutup Tahap 1 rencana.

### Apa yang masih bocor setelah 006

Patch 006 memasang Dependabot, dan di komentarnya saya tulis sendiri bahwa
blok itu **belum jujur**: tidak ada entri `pip`, karena Pillow dipatok di
baris `run:` dan Dependabot tidak bisa membaca pin di situ.

Jadi ada dua lubang yang saling menutupi:

1. Pillow terpatok tapi **tak terlihat** oleh robot yang tugasnya melihat.
2. Tidak ada apa pun yang mencegah pin berikutnya kembali ke `run:`.

### Yang berubah

- **`requirements-ci.txt`** — `pillow==12.3.0`, dibaca workflow lewat
  `pip install -r`. Sekarang Dependabot melihatnya.
- **`requirements-dev.txt`** — `numpy==2.3.5`. Saya temukan saat memeriksa:
  `scripts/cutout-cast.py` mengimpor numpy dan **tidak pernah dideklarasikan
  di mana pun**. Ia tidak jalan di CI, jadi ini bukan bug — tapi klon segar
  tidak bisa membangun ulang cutout tanpa menebak.
- **`.github/dependabot.yml`** — entri `pip` ditambahkan, komentar "belum ada
  entri pip" dihapus karena tidak lagi benar.
- **Gerbang ke-13: `scripts/check-pins.sh`.**

### Gerbang ke-13 memeriksa empat hal

| | menyala ketika |
|---|---|
| tidak ada pin pip inline | sebuah pin pindah kembali ke baris `run:` |
| semua requirement pakai `==` | ada `>=`, `~=`, atau versi telanjang |
| tidak ada versi npm mengambang | ada `*`, `latest`, atau URL |
| Dependabot menutupi tiap ekosistem yang ada | sebuah ekosistem muncul tanpa entri |

Yang terakhir adalah intinya: ia membandingkan `dependabot.yml` dengan apa
yang **benar-benar ada di pohon**. Tambahkan `requirements.txt` baru dan lupa
mendaftarkannya, gerbang merah.

Keempatnya diuji mutasi, keempatnya menyala:

```
pin pip kembali ke run:        → installs pip packages inline instead of via a requirements file
requirement pakai >=           → requirements-ci.txt has unpinned entries: pillow>=12.3.0
pip dihapus dari dependabot    → dependabot.yml does not cover pip:/
vite: "latest"                 → frontend/package.json has floating versions: vite@latest
```

### Dan satu celah lama akhirnya ditutup

Saya menandai ini dua kali tanpa memperbaikinya: **`AGENTS.md` dan
`HANDOFF.md` di luar jangkauan `check-docs.py`.** Keduanya adalah berkas yang
pertama dibaca agen baru, keduanya mengutip jumlah gerbang, dan keduanya jadi
salah **begitu gerbang ke-13 ditambahkan** — tanpa ada yang protes.

Sekarang jumlahnya dibaca dari `verify.sh` sendiri: nama gerbang unik, dengan
tanda kurung dibuang supaya `sprites (hash only)` dan `sprites (+rebuild)`
terhitung sekali, bukan dua.

Mutasi dua arah:

```
dokumen bilang 12, verify punya 13 → AGENTS.md claims 12 gates but verify.sh runs 13
gerbang ke-13 dihapus, dokumen 13  → AGENTS.md claims 13 gates but verify.sh runs 12
                                   → HANDOFF.md claims 13 gates but verify.sh runs 12
```

**Klaim dokumen 88 → 90.** Perhatikan bahwa klaim itu swa-rujuk: saat saya
menambah dua pemeriksa, gerbang klaim-total langsung merah dan menuntut README
mengaku jadi 90. Sistemnya memaksa dirinya sendiri jujur.

### Bukti

```
verify.sh  Node v22.23.3  CI=true  →  13/13 hijau  (3m19s)
check-docs                         →  PASS 90 klaim
check-pins                         →  PASS, 4/4 mutasi menyala
manifest                           →  565 berkas
```

### Status rencana setelah ini

| | |
|---|---|
| 1.1 keluar dari Node 20 | **selesai** (005) |
| 1.2 hentikan pengurai prosa | **selesai** (005) |
| 1.3 pemutakhiran keamanan | **selesai** (006) — 0 kerentanan |
| 1.4 tidak ada dependensi mengambang | **selesai** (007) |

**Tahap 1 tuntas.** Berikutnya Tahap 2 — dan itu dua keputusan produk yang
hanya Anda bisa ambil (150 sprite cast lama, dan `art/` 13 MB di repo).
Keduanya memblokir pekerjaan sprite sejak serah-terima pertama.

### Permintaan

Urutan: **003 → 005 → 006 → 007**. Jangan 004.
Balas sebagai entri **003**.

---

## 007 — Arena → Hermes · fondasi tema 宗門 (patch 008)

Entri **007 ↔ patch 008**.

User menolak arah UI sebelumnya dengan alasan yang benar: itu masih **kantor
Barat dengan karakter donghua ditempel**. Tema hanya ada di tokohnya. Patch
ini memulai perbaikannya — tapi sebagai **lapisan tema, bukan model ruangan
kedua.**

### Yang TIDAK berubah, sengaja

- **Id ruangan tetap** `server-room`, bukan `zhenfa`. Kontrak API utuh, klien
  mana pun tidak rusak.
- **12 ruangan tetap 12.** Tidak ada ruangan baru.
- Seni bawaan tidak disentuh satu byte pun.

### Satu aturan yang memegang seluruh desain

**Ketinggian tidak pernah ditulis.** `SECT_HALLS` hanya memuat nama —
tidak ada harga, tidak ada urutan, tidak ada tier. Tangganya adalah fungsi
dari `budgetHourlyUsd` milik kebijakan:

```ts
sectLadder(policy.rooms)  // 齋堂·靜室 $0 → 山門 $0.25 → 議事堂 $1
                          // → 修煉場 $2 → 丹房 $3 → 陣法室 $5 → 掌門殿 $10
```

"Policy as floor plan" sudah jadi prinsip produk sejak Fase 3 — selama ini
sebagai metafora, karena denahnya kantor datar. Sekarang denahnya vertikal
dan urutannya **diturunkan**, jadi prinsip itu punya tes yang bisa gagal.
Salah satu tesnya memeriksa tepat itu: pindahkan uangnya, gunungnya ikut
pindah. Tes lain menolak kalau sebuah angka pernah muncul di `SECT_HALLS`,
karena angka di situ adalah salinan kedua kebijakan yang bebas melenceng.

Ruangan tanpa entri kebijakan (`parking`, `rooftop`, `gym`,
`manager-office`) **bukan aula**. Tidak diatur, tidak punya kedudukan di
gunung. Itu pemodelan, bukan kekurangan.

7 tes baru. Frontend **129 → 136**.

### Seni: 4 pelat, lulus tujuh aturan tanpa keringanan

`frontend/public/rooms/sect/{lobby,main-office,server-room,ceo-office}.webp`
— nama berkas = id ruangan, jadi tema adalah pencarian direktori, bukan tabel.

| pelat | byte | unique | lumMean | offPalette |
|---|---|---|---|---|
| 山門 lobby | 306 kB | 2638 | 0,535 | 0,0% |
| 修煉場 main-office | 276 kB | 2557 | 0,469 | 0,0% |
| 陣法室 server-room | 303 kB | 2548 | 0,308 | 0,0% |
| 掌門殿 ceo-office | 289 kB | 2588 | 0,342 | 0,1% |

Gerbang magenta 3%. Dua pelat bawaan butuh `offPaletteReviewed`; **keempat
ini tidak**. Aturan seni saya jadikan batasan saat membuatnya, bukan saringan
sesudahnya.

### Dan di sinilah gerbangnya menangkap saya

**`check-plates.py` memakai `os.listdir` — datar.** Seni di subdirektori
tidak terlihat oleh ketujuh aturan: ia bisa masuk repo **tanpa terjaga sama
sekali**. Itu persis kegagalan yang file itu ada untuk mencegahnya.

Sekarang rekursif. Begitu diperbaiki, ia langsung menolak keempat pelat baru
sebagai tak tercatat — baru menerimanya setelah manifest ditulis. Manifest
**18 → 22 plate**.

### Dua angka hardcode, dua penanganan berbeda

Ini perbedaan yang saya anggap penting, bukan detail.

1. **`check-docs.py` menyimpan `"18"` sebagai literal** dan membandingkannya
   ke manifest. Itu bukan pemeriksaan dokumen — itu pemeriksa yang memegang
   salinan pribadi angka, bebas bertentangan dengan setiap dokumen sambil
   tetap melapor PASS. **Diperbaiki**: angkanya kini dibaca dari
   `docs/ROOM-PLATES.md`.
2. **`check-handoff.sh` juga memegang `18`** — tapi di sana komentarnya
   menyebut dirinya *"redundant with the hashes by design"*: tripwire
   independen supaya hilangnya satu direktori mencetak satu kalimat, bukan
   ratusan baris hash. Menurunkannya dari manifest justru merusak gunanya.
   **Di sini angkanya saya naikkan**, tidak saya turunkan.

Angka hardcode yang sama, keputusan berlawanan, karena perannya berbeda.

### Klaim mesin baru: tema harus menutupi tiap ruangan yang diatur

Id ruangan diambil dari `server/policy.js` sendiri, lalu dicocokkan ke
`SECT_HALLS`. Ruangan yang diatur tapi lupa dinamai akan merender anak tangga
kosong — jenis celah yang baru ketahuan saat seseorang akhirnya mengkliknya.

```
hapus 'server-room' dari SECT_HALLS
  → sect.ts has no hall for governed room(s): server-room
ROOM-PLATES.md diubah ke 18
  → docs/ROOM-PLATES.md plate count: doc says '18', repo has '22'
```

**Klaim dokumen 90 → 91.**

### Satu lagi yang ditangkap tsc, bukan tes

`.at(-1)` di tes gagal `tsc` (`TS2550`, butuh lib ES2022) **padahal
vitest-nya hijau** — karena `npm run build` menjalankan `tsc` lebih dulu.
Diganti indeks biasa. Menaikkan `lib` tsconfig akan jadi perubahan terpisah
yang pantas dipikirkan sendiri, bukan diselundupkan di sini.

### Bukti

```
verify.sh  Node v22.23.3  CI=true  →  13/13 hijau  (3m25s)
check-plates                       →  PASS 22 plate
check-docs                         →  PASS 91 klaim
frontend                           →  136 tes (129 + 7)
manifest                           →  571 berkas
```

### Yang BELUM ada, dan jangan dikira ada

Ini fondasi, bukan UI. Yang belum dikerjakan:

- **Belum ada komponen React.** Tangga, kabut 403, aura qi, cincin 陣法 —
  semua masih di prototipe HTML (`proto/office-sect.html` di workspace Arena),
  belum di `frontend/src/components`.
- **Pelat sekte belum dirender.** Belum ada pemilih tema; `rooms.ts` masih
  menunjuk seni bawaan.
- 4 pelat sekte **belum punya varian `@2x`**, sedangkan sebagian seni bawaan
  punya.
- Kontras APCA belum diukur. `backdrop-filter` belum diprofil.
- Hanya 4 dari 8 aula yang punya seni; 4 sisanya bernama tapi tak bergambar.

### Permintaan

Urutan: **003 → 005 → 006 → 007 → 008**. Jangan 004.
Balas sebagai entri **003** — saya masih menyisakannya.

---

## 008 — Arena — tema 宗門 jadi UI, dan gerbang ke-14

Entri 007 ditutup dengan daftar "yang belum ada". Entri ini mencoret
sebagian besarnya, dan menambahkan satu gerbang.

### Yang dikerjakan

**Delapan aula, delapan pelat.** Empat pelat sisa (議事堂, 丹房, 齋堂, 靜室)
dibuat dan masuk repo sebagai `meeting-room`, `mac-studio`, `kitchen`,
`nap-room`. Sekarang **setiap** ruangan yang diatur `DEFAULT_POLICY` punya
aula bergambar — tidak kurang, tidak lebih. Empat ruangan tak berkebijakan
tetap tanpa pelat sekte, dan itu disengaja.

`靜室` lahir di luar aturan: luminans 0,179 terhadap minimum 0,18. Meleset
0,001 adalah godaan terbesar untuk melonggarkan ambang. Tidak dilakukan.
Pelatnya dienkode ulang dengan gamma 1,20 → luminans **0,223**, yaitu di
tengah jendela, bukan menggantung di tepinya. Tidak ada mekanisme
pengecualian untuk luminans dan tidak akan saya ciptakan untuk satu berkas.

**Komponen React, bukan prototipe lagi.** `SectLadder.tsx` menggambar tangga
dari `sectLadder(policy.rooms)`; urutannya milik kebijakan, bukan milik
komponen. Aula di atas tier penonton **tidak** diredupkan — ia dikunci,
`aria-disabled`, dan klik-nya ditolak, karena server memang akan 403.
`plates.ts` memilih seni per tema dengan jatuh-kembali diam untuk ruangan
tanpa aula. `sect.css` memberi token, kabut, dan aura.

**Qi menamai, tidak menambah.** Repo sudah punya `AtmosphereLayer` (shader
WebGL) yang bereaksi pada lima state burn. `QI_NAMES` diketik sebagai
`Record<AtmosphereState, …>` — tambah state keenam dan berkas ini berhenti
dikompilasi. Tidak ada skala kedua; dua tangga untuk satu besaran adalah
awal sebuah UI berbohong.

**Gerbang 14 — `check-contrast.py`.** Kontras tema diukur dalam **APCA Lc**,
bukan rasio WCAG 2.x, karena model 1998 itu meleset di UI gelap ke dua arah.
12 pasangan token, levelnya level APCA (75 teks isi / 60 sekunder / 45
minimum). Ia mengurai `oklch()` → sRGB sendiri, dan **menolak token di luar
gamut** — browser akan memotongnya ke warna yang tidak pernah diukur.

Gerbang ini menangkap tiga kegagalan pada jalannya yang pertama, dan yang
terburuk justru rail kaca: Lc 48 terhadap 60 yang dibutuhkan. Jadi kaca
diukur sebagaimana ia benar-benar tampil — dikomposit di atas **pelat sekte
paling terang yang ada di disk**, diukur saat itu juga, bukan konstanta.
Perbaikannya: mist 0,76→0,84 dan rail 62%→78%. Saya **tidak** mengambil
margin terbesar yang tersedia: mist 0,88 lolos paling lapang tapi membuat
teks sekunder hampir seterang teks utama, dan rail 86% menghapus fros-nya.
Gerbang itu alat ukur, bukan fungsi yang dimaksimalkan.

`--sect-cinnabar` mentok: ia tidak bisa sekaligus lebih terang dan sama
jenuhnya — penjaga gamut yang menangkapnya. Diambil titik in-gamut terbaik
(Lc 50,3, dari 47,1).

Empat uji mutasi dijalankan atas gerbang ini: token digelapkan, token keluar
gamut, token dihapus, rail ditransparankan. Keempatnya menyala.

### Dua lubang di pemeriksa, ditutup

1. **`AGENTS.md` menulis "87 documented claims" padahal 91**, dan check-docs
   lolos — karena pemeriksa swa-rujuk hanya memindai empat berkas lain.
   Kelas bug yang sama dengan literal `"18"` di entri 007: dokumen boleh
   bohong di tempat yang tidak dipindai. `AGENTS.md` dimasukkan ke `SELF`;
   totalnya kini **92** (bertambah satu karena pemeriksaannya sendiri ikut
   dihitung). Diuji mutasi.

2. **Pesan kegagalan suite menuduh pihak yang salah.** Saya menemukan
   check-docs melaporkan "100 failing test(s) — fix the tests" pada pohon
   yang `node --test`-nya hijau 305/305 dua puluh kali berturut-turut.
   Sempat saya catat sebagai flake. **Itu keliru, dan repo ini tidak flaky.**
   Penyebabnya deterministik: `node_modules` dipasang dengan Node 22 (ABI
   127), lalu suite dijalankan dengan `/usr/bin/node` v20 (ABI 115), dan
   `better-sqlite3` gagal `dlopen` — mematikan setiap suite yang membuka
   ledger, kira-kira sepertiga repo.

   Repo ini mendukung Node 20/22/24 justru supaya orang berpindah-pindah di
   antaranya, jadi ini kesalahan rutin, bukan eksotis. Pesannya sekarang:
   *"the tests are fine — a native addon was built against a different Node
   version (addon built for Node 22, running Node 20). Run `npm rebuild`"*,
   plus nama tes yang jatuh dan **dump keluaran runner ke berkas**. Kegagalan
   yang tidak meninggalkan jejak tidak bisa diperbaiki; yang ini sekarang
   meninggalkan jejak sendiri tanpa ada yang perlu mengingat sebuah flag.

### Bukti

```
verify.sh  Node v22.23.3  CI=true  →  lihat blok di bawah
check-plates                       →  PASS 26 plate (18 bawaan + 8 sekte)
check-contrast                     →  PASS 12 pasangan token, APCA
check-docs                         →  PASS 92 klaim
frontend                           →  148 tes (136 + 12)
backend                            →  305 tes
```

### Yang masih belum ada

- **Belum ada pemilih tema di UI.** `sect.css` dimuat dan `plates.ts` siap,
  tapi belum ada yang menyetel `data-theme="sect"` atau memanggil
  `platePath()` dari `rooms.ts`. Tema sudah bisa dirender, belum dinyalakan.
- Cincin 陣法 dan sapuan tinta View Transitions masih di prototipe.
- Pelat sekte belum punya varian `@2x`.
- `backdrop-filter` belum diprofil pada perangkat lemah.
- tsconfig `lib` masih di bawah ES2022 (lihat entri 007).

### Permintaan

Urutan: **003 → 005 → 006 → 007 → 008 → 009**. Jangan 004.
009 butuh tarball asetnya diekstrak lebih dulu, sama seperti 008.
Balas sebagai entri **003** — masih saya sisakan.
