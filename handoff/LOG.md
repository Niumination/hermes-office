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

---

## 009 — Arena — temanya dinyalakan, dan sebuah hang ditemukan

Entri 008 ditutup dengan kalimat: *"temanya bisa dirender, belum
dinyalakan."* Entri ini menyalakannya — dan dalam prosesnya menemukan bug
yang tidak ada hubungannya dengan tema.

### Temanya kini benar-benar hidup

`themeStore.ts` menyimpan pilihan dan menaruhnya di `<html data-theme>`,
karena atribut itulah sumber kebenaran bagi CSS. Memakai
`useSyncExternalStore`, bukan Context: dua pihak yang butuh nilai ini —
toggle di topbar dan pencarian pelat jauh di dalam `OfficeStage` — terpisah
oleh selusin komponen yang tidak peduli nilai itu.

`OfficeStage.tsx` berubah **satu baris** secara efektif:

```
const defaultImage = phase === 'night' ? room.background.night : room.background.day
const roomImage = platePath(room.id, theme, defaultImage)
```

Tema memilih pelat; fase siang/malam memilih pelat bawaan mana yang
*seharusnya* dipakai. Jatuh-kembali tetap total untuk 12 ruangan.

`ThemeToggle.tsx` adalah sakelar dua-state dengan **kedua label selalu
terlihat**, bukan tombol ikon yang berganti makna saat ditekan — yang kedua
memaksa pembaca mengingat apakah ikon menunjukkan keadaan sekarang atau
keadaan yang akan didapat.

Setiap akses `localStorage` dibungkus. Safari mode privat melempar di sana,
dan dasbor tata kelola yang layar-putih karena gagal mengingat skema warna
adalah cara memalukan untuk mati. Ada tesnya.

### Bug yang ditemukan: hang di `prefers-reduced-motion`

Saat menulis tes yang merender `OfficeStage` dengan reduced-motion menyala,
worker vitest mati **SIGABRT, kehabisan memori**. Itu bukan tesnya.

`OfficeStage` punya efek yang **bergantung pada `agents` dan juga menulis
`agents`**:

```
useEffect(() => {
  if (!reducedMotion) return
  setAgents(prev => prev.map(a => ({ ...a, position: {...}, ... })))
}, [agents, reducedMotion])
```

`prev.map()` selalu mengalokasikan array dan objek baru, jadi React selalu
melihat nilai baru, menjalankan ulang efeknya, selamanya. Ia bahkan tidak
bisa konvergen secara prinsip: salah satu field yang ditulisnya,
`statusText: workMessage()`, acak.

Artinya **tab mengunci bagi siapa pun yang menyalakan
`prefers-reduced-motion`** — yaitu persis orang-orang yang cabang kode itu
ada untuk melayani. Bug ini sudah ada sebelum tema sekte; ia tidak pernah
ketahuan karena tidak ada tes yang pernah merender panggung dengan
reduced-motion menyala.

Perbaikannya: sentuh agen hanya bila ia memang melenceng dari sasarannya,
dan kembalikan array sebelumnya apa adanya bila tidak ada yang berubah —
identitas yang sama itulah yang membuat React berhenti.

Dua tes regresi ditambahkan. Mode gagalnya adalah **hang**, bukan ekspektasi
merah, jadi tes itu lulus dengan cara selesai; ekspektasi di dalamnya ada
untuk membuktikan perilaku yang seharusnya tetap diberikan.

### Pasangan kontras baru, didaftarkan saat dibuat

Tombol terpilih menggambar `--sect-ink-0` di atas `--sect-gold` — satu-satunya
pasangan terbalik (gelap di atas terang) di tema ini, dan pasangan yang
gerbang 14 belum ukur. Ia didaftarkan pada saat yang sama ia dibuat, bukan
nanti: Lc **78,4**. Pasangan yang diketahui perancang tapi tidak diketahui
gerbang lebih buruk daripada tidak ada gerbang, karena ia menjual rasa aman
yang palsu. Gerbang 14 kini **13 pasangan**.

CSS toggle adalah satu-satunya aturan di `sect.css` yang **tidak** dicakup
`[data-theme="sect"]`, dan memang harus begitu: ia kontrol yang menyalakan
tema, jadi ia wajib terlihat saat temanya mati. Gaya dasarnya hanya memakai
`currentColor`, supaya ia mewarisi tema inang alih-alih memperkenalkan
pasangan warna yang tidak diukur siapa pun.

### Satu kesalahan diagnosis yang pantas dicatat

`check-docs` sempat melaporkan "this run checked 91" terhadap dokumen yang
menulis 92 — satu pemeriksaan hilang diam-diam. Saya sempat memburunya
sebagai regresi kode. Bukan: pohon ujinya belum dipasangi `node_modules` di
akar, jadi pemeriksaan hitungan tes backend **SKIP**, dan skip menurunkan
total. Backstop swa-rujuk yang menangkapnya, persis sesuai tujuannya.
Pelajarannya untuk pembaca berikutnya: `SKIP` bukan hal netral di berkas
ini — ia menggeser angka yang diklaim dokumen.

### Bukti

```
verify.sh  Node v22.23.3  CI=true  →  14/14 hijau
check-contrast                     →  PASS 13 pasangan token, APCA
check-docs                         →  PASS 92 klaim
frontend                           →  160 tes (148 + 12)
backend                            →  305 tes
bundel                             →  216,57 kB JS / 46,98 kB CSS
```

### Yang masih belum ada

- Cincin 陣法 dan sapuan tinta View Transitions masih di prototipe.
- `SectLadder` ada, teruji, **tapi belum dipasang di tata letak** — ia butuh
  keputusan tata letak (menggantikan atau mendampingi pemilih ruangan yang
  ada), dan itu keputusan produk, bukan keputusan saya.
- Varian `@2x` pelat sekte.
- `backdrop-filter` belum diprofil pada perangkat lemah.

### Permintaan

Urutan: **003 → 005 → 006 → 007 → [tarball 008] → 008 → [tarball 009] → 009
→ 010**. Jangan 004. Patch 010 murni teks, tidak ada tarball.
Balas sebagai entri **003** — masih saya sisakan.

---

## 010 — Arena — angka utama di README meleset 38%, dan tidak ada yang memeriksanya

Entri ini dibuka dengan pengakuan. Diagnosis saya sebelumnya — *"pekerjaan
ada di `dev`, deploy menarik dari `main`, jadi situs tak mungkin
berubah"* — **salah**. Rapi, masuk akal, dan salah. Begitu saya periksa
bundel yang benar-benar dikirim ke browser, patch 003–010 sudah ada di
sana. Pelajarannya saya catat supaya tidak terulang: ketika gejalanya
"kode sudah diterapkan tapi tak muncul", **periksa artefak yang
dilayani**, jangan menyimpulkan dari topologi branch.

Pekerjaan Anda di `dev` juga melampaui serah-terima: i18n penuh,
`SectLadder` terpasang, dan `957582f` yang memperbaiki rail untuk guest
menutup item yang saya tinggalkan terbuka. `main` kini sumber kebenaran,
CI berjalan di tiga branch, dan `DEPLOYMENT.md` bukan cuma diperbaiki
tapi diberi alasan. Tidak ada yang perlu dibela di sana.

### Yang saya temukan

Dua hal, dan yang kedua lebih serius daripada yang pertama.

**1. `frontend/dist` di server dibangun dari pohon tak ter-commit.**
Bundel publik memuat class `sect-ladder2` dan `sect-glass`. Keduanya nol
kemunculan di `main`, di `dev`, dan di salinan kerja saya. Bundel itu juga
kehilangan `.sect-ladder__note`, tidak memuat string `policy` sama sekali
padahal `policyClient.ts:113` memanggil `fetch('/policy')`, dan menyajikan
`<title>Hermes Office</title>` padahal sumbernya `Kantor Hermes`. Artinya
perbaikan guest `957582f` belum benar-benar hidup. Prosedurnya ada di
`RUNBOOK-server-dist-kotor.md`; **FASE 0 menyelamatkan dulu, baru
menimpa** — `sect-glass` mungkin pekerjaan nyata yang belum di-commit.

**2. README menjanjikan bundel 216 kB; build bersih `4c8b4ca`
menghasilkan 298,9 kB.** Meleset **+38%**, dan `check-docs.py` tidak
memeriksanya — itulah sebabnya 92 klaim tetap hijau sementara angka
paling menonjol di tabel justru salah.

Ini bukan soal kosmetik. Ukuran bundel **adalah** keseluruhan ADR D3: kita
menolak React Three Fiber dengan alasan ia memakan ~250 kB sementara kita
mengirim +7,8 kB. Angka 216 kB yang tak diperiksa membuat argumen itu
tetap bisa dikutip lama setelah ia berhenti benar. Untuk produk yang
menjual keterverifikasian, klaim yang tidak diverifikasi di baris paling
dibaca adalah kerusakan terburuk yang bisa terjadi.

Uji mutasi juga memperlihatkan bahwa klaim CSS **43,7 kB sudah meleset 8%
bahkan sebelum** enam major itu masuk. Jadi angka itu tidak pernah benar;
ia hanya tidak pernah ditanya.

### Yang saya kerjakan (patch 011)

- **Gerbang baru di `check-docs.py`**: ukuran bundel dibaca dari
  `frontend/dist/assets`, dibandingkan dengan kedua README, toleransi 3%
  (cukup menyerap ketidakstabilan minifier, tidak cukup menyerap lompatan
  major). Klaim 92 → **94**; angka swa-rujuk di lima berkas ikut naik.
- **Dokumen diselaraskan dengan kode**, bukan sebaliknya: React 19 dicabut
  dari daftar non-goal PRD §3.2 karena ia sudah masuk; R3F **tetap**
  non-goal, dan ADR D3 kini menyandarkan diri pada alasan ukuran yang
  memang tidak pernah bergantung pada versi React. `ARCHITECTURE.md` §7
  mencatat terus-terang bahwa penghalang versinya gugur. Express 4 → 5 di
  tiga berkas, React 18 → 19 di `CONTRIBUTING.md`.
- `docs/LEGACY-README.md` **sengaja tidak disentuh** — ia arsip, dan
  mengubahnya memalsukan sejarah. Begitu pula `CHANGELOG-v2.md` dan entri
  lama di berkas ini.

Kesalahan kedua yang layak dicatat: rancangan pertama gerbang ini
mem-*skip* diri saat `frontend/dist` tidak ada. Itu akan menjatuhkan
hitungan ke 92 sementara README mengklaim 94, dan larian mati dengan
pesan *"this run checked 92"* — merah yang menyebut masalah yang salah,
persis cacat yang file ini ada untuk mencegah. Sekarang ia menghitung
tetap dan gagal dengan instruksi build.

Diuji mutasi lima cara: angka JS dipalsukan (merah, menyebut +38%), baris
dibuat tak terbaca (merah), `dist` dihapus (merah, tetap 94, menyebut
perintahnya), CSS melenceng 8% (merah), lalu pulih (hijau 94).
`verify.sh` **14/14**. Backend 305, frontend 170.

### Permintaan

1. Terapkan **patch 011** (`patch -p1`, murni teks, tanpa tarball).
2. Jalankan `RUNBOOK-server-dist-kotor.md` — FASE 0 dulu.
3. Pertimbangkan FASE 4 runbook: endpoint `/health` yang mengumumkan commit
   SHA, dan penolakan deploy dari working tree kotor. Hari ini satu-satunya
   bukti bahwa situs cocok dengan repo adalah menebak dari nama class di
   bundel terminifikasi. Itu terlalu mahal untuk produk ini.
4. Dua keputusan di `HANDOFF.md` §4 sudah diputuskan pemilik: **hapus 150
   sprite cast lama** (risiko HKI) dan **pertahankan `art/`**. Saya kerjakan
   berikutnya kecuali Anda sudah memulainya — beri tahu lewat entri 003.

Entri **003** masih saya sisakan untuk Anda.

---

## 011 — Arena — 150 sprite dihapus, dan dua gerbang belajar membedakan "hilang" dari "dibuang"

Pemilik memutuskan kedua item yang menggantung di `HANDOFF.md` §4:
**hapus 150 sprite cast lama**, **pertahankan `art/`**. Keduanya sudah
diterapkan. §4 ditulis ulang dari "dua keputusan yang sengaja tidak saya
ambil" menjadi catatan keputusan yang sudah diambil.

### Yang dihapus, dan kenapa itu bukan soal ukuran

`frontend/public/sprites/office/characters` (108) dan
`frontend/public/sprites/characters` (42). Ukuran memang turun — 7,9 MB →
3,2 MB, 282 → 132 webp — tapi itu efek samping. Alasannya: 108 berkas itu
rupa yang dapat dikenali dari sebuah serial televisi, di dalam produk
berharga $2.000+. Nol dirujuk `frontend/src`; aplikasi memakai 8 arketipe
donghua. Jalur mundur satu baris di `Character.tsx` memang nyata, tapi
menahan paparan HKI sebagai harga sebuah opsi yang tak akan ditebus adalah
pertukaran yang buruk.

Hasil sampingan yang justru paling berharga untuk penjualan: **`unsourced`
sekarang nol**. Seluruh 132 sprite yang dikirim bisa dibangun ulang dari
sumber yang ter-commit — 100 `derived` dari `art/originals/sprites`, 32
`built` dari 16 render di `art/donghua-cast`. Itu klaim yang jauh lebih
kuat daripada "282 sprite, 132 di antaranya reproducible".

### Dua gerbang tidak diturunkan angkanya — mereka diperkuat

Menurunkan 282 → 132 dan 150 → 0 saja akan melewatkan intinya. Yang
berubah adalah bentuk klaimnya.

`check-docs.py` dulu memverifikasi bahwa **setiap** karakter tidak
bersumber — ia menjaga agar prosa tentang sebuah celah tidak hidup lebih
lama dari celahnya. Penggantinya: **nol sprite boleh tanpa sumber**, plus
satu cek bahwa kedua direktori itu tidak muncul kembali. Jumlah klaim tetap
**94** — sebelas cek masuk, sebelas keluar.

`check-assets.sh` menolak kehilangan aset upstream. Tapi aset bisa pergi
karena dua sebab yang tidak boleh terlihat sama: **jatuh dari pipeline**
(cacat yang skrip ini ada untuk menangkap) dan **dibuang sengaja**
(keputusan). `ASSET-MANIFEST.json` kini punya blok `removals` dengan
alasan, efek yang diketahui, apa yang **tidak** ikut dihapus, dan apa yang
**belum tuntas** — mengikuti pola `corrections` yang sudah ada. Harapannya
simetris: aset yang tercatat dibuang dan ternyata **ada** juga merah.
Berkas yang dipulihkan dari riwayat Git cocok dengan hash-nya sendiri, jadi
tak satu pun gerbang lain akan menyadarinya.

Diuji mutasi dua arah: menghapus aset upstream yang sah → `MISSING`;
mengembalikan `andy-bernard-front-left` → `RETURNED`. Percobaan pertama
saya keliru memilih korban dari `sprites/donghua/`, yang memang bukan aset
upstream — tesnya yang salah sasaran, bukan gerbangnya.

### Yang belum tuntas, dan harus dikatakan

Repo ini **publik**. `git rm` tidak menghapus apa pun dari riwayat: ke-108
rupa itu masih dapat diambil dari commit mana pun sebelum `4c8b4ca`. Ini
menghentikan distribusi ke depan — **bukan** remediasi HKI yang selesai.
Remediasi penuh menuntut `git filter-repo` dan paksa-dorong, yang memutus
setiap klon dan setiap SHA yang pernah dikutip, termasuk di
`MANIFEST.sha256`. Pertukaran itu milik pemilik, bukan milik saya.

Satu sisa sengaja dibiarkan:
`art/originals/sprites/office/props/schrute-buck.webp` dan sprite props
turunannya. Serial yang sama, tapi benda, bukan rupa orang — dan ia punya
sumber. Kalau standarnya diperketat ke "nol rujukan HKI", itu yang
berikutnya.

### Tiga klaim basi yang ikut ketahuan

Bukan bagian dari tugas; ditemukan karena angkanya disentuh.

- `AGENTS.md` menulis `art/` **5,2 MB**; sebenarnya **13 MB**.
- `HANDOFF.md` menulis **87** doc claims; sebenarnya **94**.
- `README` menulis bundel **216 kB**; sebenarnya **298,9 kB** (patch 011).

Ketiganya tidak pernah diperiksa gerbang mana pun. Dua yang pertama kini
dikoreksi; yang ketiga kini punya gerbang.

`verify.sh` **14/14**. Backend 305, frontend 170. Pohon: 589 → **439**
berkas.

### Permintaan

Patch 012 **tidak** memuat penghapusan berkas biner — `diff` tidak bisa
membawanya. Terapkan dalam urutan ini:

```bash
git rm -r frontend/public/sprites/office/characters frontend/public/sprites/characters
patch -p1 < 012-hapus-cast-lama.patch
bash scripts/verify.sh          # harus 14/14
```

Kalau `verify.sh` merah di `handoff integrity`, jalankan
`bash scripts/check-handoff.sh --write` **hanya setelah** 13 gerbang lain
hijau — itu urutan yang dipaksakan skripnya sendiri, dan ada alasannya.

---

## 012 — verification as the product (patch 013)

**Apply after 012. Order matters only in that 013 touches `scripts/verify.sh`
and `package.json`, both of which 011/012 also touch.**

```bash
patch -p1 < 013-verifikasi-yang-bisa-dijual.patch
bash scripts/verify.sh          # expect 14/14
```

Stage 3.1 of RENCANA-v3 asks for one thing: a buyer should be able to clone
this repo, run a single command, and watch the claims prove themselves. That
is now true, and it was not before.

**What changed**

- `package.json` gains `verify` and `verify:fast`. The gates existed; they
  were reachable only as `bash scripts/verify.sh`, which is not a thing you
  put on a pricing page.
- `README.md` / `README.id.md` gain a **Verify it yourself** section: the
  four commands, the measured runtime, and a table of all 14 gates with what
  each one proves.
- `docs/PRICING.md` / `.id.md` gain **Every number on this page is
  executable**, placed immediately after the $2,000+ argument, because that
  argument is the one that needs the evidence.
- `scripts/verify.sh` gains a Node floor check before the install step.
- `scripts/check-docs.py` gains 8 checks (94 → 102) binding the new sales
  copy to the code.

**The measurement, and the trap inside it**

Measured from a clean tree, no `node_modules`, no `dist`, on 2 cores:
`npm ci` 5 s, `npm run verify` 201 s — **206 s, about 3.5 minutes.** Inside
the plan's five-minute budget.

The first attempt at that measurement came back **5 of 14 red**: zero frontend
tests, 56 backend failures, doc claims failing 7 of 94. I nearly wrote it up
as a product defect — the headline claim failing on a clean clone. It was not.
`/tmp` had been wiped mid-session, the Node 22 I had put there was gone, and
the run had silently fallen back to the system Node 20. better-sqlite3 13 is
a native addon built against a newer ABI; on Node 20 the backend suite does
not fail, it **crashes**, and the surrounding gates then report numbers that
are pure fiction.

**That is why the Node floor check is in this patch.** A buyer on Node 20 was
going to see exactly what I saw: a wall of red that looks like broken code
and is actually a wrong runtime. Nobody reading that output would have filed
a bug; they would have closed the tab. The check reads the floor from
`engines.node` rather than hard-coding 22, so it cannot drift from the field
it enforces, and it runs before `npm ci` so nothing expensive happens first.

**Binding the new claims (the 8 checks)**

A pricing page that boasts about executable claims and then misstates its own
gate list is worse than one that never boasted, so the boast is itself under
test:

| Checks | What rots without it |
|---|---|
| 2 | `verify` / `verify:fast` renamed out of `package.json`, leaving every doc pointing at a command that does not exist |
| 4 | the advertised gate count drifting from what `verify.sh` runs (4 docs) |
| 2 | the README gate table going stale — compared **row for row and in order** against `verify.sh` |

Mutation-tested four ways, all caught, all restored:

1. delete `verify:fast` from `package.json` → *"the docs tell buyers to run
   `npm run verify:fast`, but package.json has no "verify:fast" script"*
2. delete a row from the README table → *"missing 'sprites (+rebuild)'"*
3. add a gate to `verify.sh`, touch no docs → *"README.md advertises 14
   gates; verify.sh runs 15"* (×2 files)
4. swap two table rows → *"same gates in a different order"*

Mutation 3 is the one worth keeping. The failure mode it covers is not a
typo, it is the normal, well-intentioned act of adding a gate — the exact
moment the sales copy silently stops being true.

**Still not done**

No CI badge. The plan asks for one and the workflow supports it, but a badge
is a picture of a claim rather than a claim, and the section reads honestly
without it. Worth adding when someone is next in `.github/`.

---

## 013 — enterprise review readiness (patch 014)

**Apply after 013.**

```bash
patch -p1 < 014-sbom-dan-matriks-dukungan.patch
npm run sbom          # not required — the patch carries sbom.cdx.json
bash scripts/verify.sh   # expect 15/15
```

Stage 4 of RENCANA-v3: the things a $2,000+ buyer asks for before signing.
Four of the five items are here. The ledger load test is not.

**New gate 15 — `sbom`**

`scripts/make-sbom.py` builds a CycloneDX 1.6 document from both lockfiles
and nothing else. 289 components, 71 runtime and 218 dev. `--check`
regenerates it and demands a byte-for-byte match, which is the same bargain
as the sprite gate: a recorded fingerprint only proves a file has not been
edited, never that it still describes anything real.

That bargain is only available if the generator is deterministic, so it
**writes no timestamp** and derives `serialNumber` from a hash of the
component set. The cost is explicit: the committed SBOM answers "what is in
this tree", not "when was this generated". Git answers the second question
and cannot be made to lie about it by re-running a script. A release process
that needs a stamped SBOM should stamp this one at release time — stamping is
an action with a date; a generator that stamps itself is just a clock.

It reads the lockfiles, never `node_modules`, so it works on a clean clone.
Lockfile v3 carries `license` for all 145 root entries, so nothing needs to
be installed to resolve them.

CI uploads `sbom.cdx.json` as an artifact on every run, not only on tags. A
reviewer asking "what is in this build" should be able to answer it for the
commit in front of them.

**`docs/SUPPORT.md` — and the uncomfortable thing it says**

"Supported" now has one meaning: CI runs the full gate suite on that version,
and a red gate there blocks the release. Two legs, 22 and 24.

Writing it down forced two admissions that were true before and unsaid:

- **The floor is already a maintenance-only release.** Node 22 stopped
  getting anything but security fixes in October 2025 and is gone on
  2027-04-30 — about seven months out. The floor stays at 22 because raising
  it breaks existing installs for no technical reason yet, but it is a dated
  decision and the page says so.
- **Node 26 becomes Active LTS on 2026-10-28 and is untested here.** It is
  listed as unknown, not supported, because a support claim no CI leg stands
  behind is the exact thing the rest of this repo exists to prevent.

Also recorded: `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19, under this
matrix, unexercised.

**Four new doc checks (102 → 106)**

| Binds | So that |
|---|---|
| SUPPORT.md versions ↔ CI matrix | adding a CI leg cannot leave the page behind |
| SUPPORT.md floor ↔ `engines.node` | the floor is declared once and quoted, never restated |
| each listed EOL ↔ today's date | a support claim expires on the day it expires |
| the quoted preflight text ↔ `verify.sh` | a documented error message stays the one actually printed |

The third is a deliberate time bomb. On 2027-04-30 this build goes red with
no commit to blame, and that is correct: the claim really does stop being
true that morning, and the alternative is a page that keeps saying 22 is
supported for as long as nobody rereads it.

Mutation-tested, victims taken programmatically, all six caught and restored:
CI leg added (`claims support for Node 22, 24 but the CI matrix runs 22, 24,
26`), floor raised to 24, an EOL date moved into the past, the preflight
wording changed, a lockfile version bumped without regenerating the SBOM
(`+ pkg:npm/@cacheable/memory@99.99.99`), and the SBOM deleted outright.

**A gate that demanded history be rewritten**

Bumping the count to 15 turned `HANDOFF.md` red over `13/14 gerbang hijau` —
a dated record of how one particular run went. The old check matched a bare
`(\d+) gerbang` anywhere in the file, so staying green meant editing a note
about the past into something that never happened. The check now binds only
the live claim, the row in the script table. A checker that forces the past
to be rewritten to stay green is worse than no checker.

**Disclosure policy — `SECURITY.md` §11**

Private advisory, no public issues, no real tokens in reports. Committed
windows: acknowledge in 3 working days, triage in 10, fix or documented
mitigation for critical in 90, public advisory 7 days after release. A
rejected report gets a written reason citing a line in §1 — and if the threat
model is what is wrong, that is what gets fixed. No bounty. Safe harbour for
good-faith work on your own instance.

**What is not for sale, named**

Both pricing pages now say it without the euphemism: no SOC 2, no ISO 27001,
no HIPAA BAA, no signed DPA, no third-party pen test, no uptime or
response-time SLA, no support for a Node outside the CI matrix. Each of those
could be sold by writing one sentence, and not writing them is the only
reason the other sentences are worth anything.

**Still open**

The ledger load test. It is the last synthetic performance number in the
documentation and the only Stage 4 item left. It wants a real multi-client
run, not an estimate, and it did not fit in this patch.

---

## 014 — the ledger under concurrent clients (patch 015)

**Apply after 014.**

```bash
patch -p1 < 015-uji-beban-ledger.patch
bash scripts/verify.sh   # expect 16/16
```

Last Stage 4 item, and the last synthetic performance number in the
documentation.

**What was wrong with the old number**

FLIGHT-RECORDER.md §9 reported 0.020 ms per record, ~49,000 decisions/s. The
number was real and honestly caveated about fsync — but it was measured
**in-process**: a loop calling `ledger.record()` directly. One caller, one
thread, no HTTP, no Express, no concurrency. It answers "how expensive is an
append" and cannot answer the question a buyer actually asks, which is
whether the chain survives a fleet hitting it at once.

That distinction matters more for a hash chain than for most structures.
Every append depends on the previous one's hash, so interleaved writers
produce a fork, a duplicate sequence number, or a silently dropped record —
and all three still look like a ledger from the outside.

**New gate 16 — `ledger under load`**

`scripts/bench-ledger.mjs` boots the real server on a temp DB, drives
concurrent decisions through HTTP, then asserts the chain survived:
`/ledger/verify` ok, sequence contiguous, no duplicates, every record linked
to its predecessor, and the allow path actually exercised. 16x25 under
`--check` (about 1 s, inside the gate suite); 50x40 for the full run.

**Measured, 50 agents x 40 decisions = 2,000, synchronous=FULL, 2 cores:**

| | |
|---|---|
| Throughput | ~1,300 decisions/s end to end |
| Latency | p50 33 ms · p95 64 ms · p99 ~80 ms |
| Records written | 2,054 (2,000 decisions + 50 placements + checkpoints) |
| Whole-chain verify | ok, ~16 ms |

Stable across three consecutive runs: 1,301 / 1,325 / 1,331 per second.

**The finding worth keeping**

49,000/s in-process versus ~1,300/s end to end is a 37x gap. **The ledger is
not the bottleneck** — it is roughly 1.5% of the cost of a decision; the rest
is HTTP, Express and policy evaluation. Anyone optimising this path should
not start here, and anyone worried that a full audit trail will slow their
fleet down can stop worrying. That is a far more useful sentence than
"49,000/s", and the old number could not produce it.

**What is enforced versus what is printed**

Integrity only. Timing is a property of the machine, and a gate that goes red
when a runner is busy teaches people to re-run gates until they pass, which
destroys the value of every other gate in the suite. The throughput is
printed with the hardware that produced it and nothing depends on it.

**Two things the first version got wrong**

The first run reported *400 allowed, 0 denied* — no, it reported the
opposite: **0 allowed, 400 denied**, and still passed, because the chain was
intact. It was measuring the deny path exclusively. A new agent lands in the
Lobby, whose scope is deliberately narrow, so every request was refused
before it reached anything interesting. The bench now places the fleet in
`main-office` first (owner-only, and itself recorded — a realistic mix), and
a run where nothing is allowed is now an explicit failure rather than a
green tick.

The second: `/policy/check` is rate limited per agent at 600/min, burst 60
per 5 s. One client looping would have measured the limiter. The load is
spread across distinct agent identities, each under its own burst — which is
also the shape of the workload this product exists to watch.

**Mutation-tested, all caught with distinct reasons**

1. stale `prevHash` every 50th record (the classic interleaving bug) →
   `verify ok=false reason=broken-link`
2. one sequence number skipped → `reason=sequence-gap` **and**
   `1 gap(s) in the sequence: 120→122`
3. ledger disabled outright → `the ledger recorded nothing at all during the
   load`
4. load shape changed in the script, docs untouched → `reports a run of
   50x40 but bench-ledger.mjs runs 50x30`
5. `bench:ledger` removed from package.json → `tells the reader to run
   npm run bench:ledger, but package.json has no such script`

Doc claims 106 → 108. CI runs the gate on both legs.

**Stage 4 is now complete.** SBOM, support matrix, disclosure policy,
compliance note, load test. What remains in RENCANA-v3 is 3.2 (blocked on a
Cloudflare account), 3.3 (niu-mode) and 3.4 (marketplace).

---

## Arena → Hermes · PR `arena/sect-ui-id` (antarmuka perguruan, di-rebase ke b3ef09e)

Pemilik repo meminta PR untuk seluruh pekerjaan UI. Pemeriksaan pertama
membatalkan rencana aslinya: `main` dan `dev` sudah di `b3ef09e`, **diverged**
dari `4c8b4ca` yang jadi basis tumpukan patch 011–018 (bukan leluhur; merge-base
`3376eb7`). Agen Hermes sudah mengintegrasikan 011–015 sendiri di `2d1ce12`.

Menerapkan tumpukan itu apa adanya akan menghapus 38 berkas frontend dan
**memundurkan** `server/index.js` — perbaikan SPA fallthrough (`fallthrough:
true` + `app.use`) tidak ada di pohon lama. Jadi PR ini dibangun ulang di atas
`b3ef09e`, bukan di-replay.

### Yang diselamatkan, dan mengapa itu bukan opsional

`GET /presence` hanya dipanggil di satu tempat: `hermes/OfficeStage.tsx`, berkas
yang penggantian tampilan ini hapus. Tiga perilaku ikut di dalamnya — seeding
saat mount (socket tidak punya replay), polling 30 dtk (tab semalaman akan
melenceng), dan watchdog 90 dtk (cermin aturan server). Menghapusnya berarti
situs live memuat dengan roster kosong, dan agen yang mati sejam lalu tampak
identik dengan agen yang tak pernah ada.

Diekstrak ke `hermes/usePresence.ts` dengan 6 tes. Intinya bukan "pindah
berkas": presence adalah fakta tentang armada, bukan properti satu renderer.
Tampilan berikutnya mendapatkannya gratis — yang persis tidak terjadi kali ini.

`formatLastSeen()` ikut pindah dari `components/Character.tsx` ke `hermes/wib.ts`.
Ia formatter waktu, bukan urusan sprite; meninggalkannya di berkas yang dihapus
adalah cara badge luring hilang diam-diam bersama karakter yang memakainya.

### Satu keputusan desain yang sengaja asimetris

Roster menampilkan agen yang diketahui server meski socket belum bicara. Aula
**tidak**. Presence menjawab "siapa hidup", bukan "di mana"; menggambar agen ke
dalam aula atas dasar itu adalah UI mengarang lokasi. Mereka duduk di roster
dengan "terakhir aktif HH:MM" sampai sebuah peristiwa menempatkannya.

### Yang hilang, dan harus disebut

`ChatPanel` dan `GithubFeed` ikut terhapus bersama kantor isometrik; Babad
menggantikan keduanya sebagai aliran peristiwa, tetapi kolom chat `channel_msg`
tidak punya pengganti visual di PR ini. Tes frontend turun 170 → 90 — penurunan
jujur, karena tes pathfinding dan sprite mati bersama kode yang diujinya.

### Gerbang

16/16 hijau di branch ini. Gerbang 14 naik 13 → 26 pasangan token (dua palet),
gerbang 15 naik 108 → 111 klaim. `scripts/check-contrast.py` dan
`scripts/check-docs.py` versi lama tidak bisa membaca pohon ini sama sekali —
yang pertama gagal pada lightness persen, yang kedua mencari `styles/donghua.css`
yang sudah tidak ada.
