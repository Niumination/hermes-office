# UI Spec — Hermes Office v2 (Perguruan / sect)

> Dokumen ini menggambarkan antarmuka yang **benar-benar dikirim**. Versi
> sebelumnya menggambarkan UI kantor isometrik Barat dengan lima stylesheet
> dan selusin komponen; semuanya sudah dihapus dari pohon. Spesifikasi yang
> menggambarkan UI yang tidak lagi ada adalah kewajiban, bukan aset — pembeli
> membacanya, lalu menemukan produknya berbeda.
>
> Angka di dokumen ini diperiksa mesin. `scripts/check-docs.py` membandingkan
> setiap hitungan baris, jumlah token, dan nama berkas di bawah ini dengan
> pohon sumber, lalu gagal bila salah satu meleset. Jangan sunting angkanya
> agar cocok; perbaiki yang mana pun yang salah.

---

## 1. Prinsip

1. **Kantor → ruang → meja → agen.** Rail kiri adalah model ekosistem pemilik,
   bukan tangga kepercayaan: mesin (Mac / LightVela), kategori folder, repo,
   lalu topik Telegram. Dua kantor tampil bergantian, tidak berdampingan.
   _Dicabut:_ "Tataran = izin". Tingkat kepercayaan dicabut di `20248f2`; satu
   pemilik tidak punya tataran untuk dinaiki.
2. **Tenaga = burn.** Belanja adalah energi yang mengalir, bukan angka di pojok.
   Lima keadaan server (`normal → warm → hot → critical → tripped`) menjadi
   lima warna qi.
3. **Tidak ada aula yang tertutup bagi pemiliknya.** _Dicabut:_ tabir "Lenyap
   di Balik Kabut". Ia hanya bisa terangkat lewat perbandingan tataran yang
   benar secara konstruksi, jadi tak pernah sekali pun muncul, dan teksnya
   menjanjikan 403 per-aula yang kantor satu-pemilik tak bisa terbitkan.
   `check-docs.py` kini menolak kembalinya `viewerTier`/`canEnter`/`sect-veil`.
4. **UI tidak boleh mengarang penolakan, dan tidak boleh menyembunyikan angka
   yang sudah diketahui.** Dua sisi dari satu aturan. Menampilkan "diredaksi"
   atas data yang dikirim server adalah kebohongan; menampilkan `$0` atas pagu
   yang diredaksi juga.
5. **Replay adalah tata kelola.** Kronik dan Segel bukan pelengkap — keduanya
   adalah argumen produk.

---

## 2. Tata letak (desktop ≥1180 px)

```
┌────────────────────────────────────────────────────────────────────────┐
│  bilah: Perguruan · status · Tenaga · Murid · Segel · niu · ID/EN      │
├──────────────────┬─────────────────────────────────┬───────────────────┤
│  rail ekosistem  │          aula (hall)            │  Titah (writ)     │
│  [Mac|LightVela] │                                 │  ──────────────   │
│  Root Ekosistem ·│  pelat sinematik + 2 awan +     │  Babad (chronicle)│
│  Apps          9 │  grade + vignette               │  / roster Murid   │
│  Services      3 │  Murid berdiri di denah         │                   │
│  …               │  angka = jumlah MEJA,           │  auto-scroll      │
│  Vault         0 │  bukan jumlah penghuni          │  hanya di ekor    │
└──────────────────┴─────────────────────────────────┴───────────────────┘
```

Grid tiga kolom. Rail memakai `flex-direction: column-reverse` sehingga aula
berperingkat tertinggi berada di atas secara harfiah — urutan DOM tetap dari
rendah ke tinggi agar pembaca layar menyusurinya sesuai tangga kebijakan.

**Breakpoint.** 1180 px (rail menyempit, panel kanan tersembunyi), 860 px (rail tersembunyi, lajur papan menggulir mendatar).

**Kerangka.** Kantor adalah halaman. Kedua rail dapat ditutup lewat tombol mengambang di atas kanvas; kolom grid `auto` sehingga lebar yang dilepas rail jatuh ke panggung, bukan jadi celah. Status bar duduk di kaki panggung. Amanat dibuka sebagai hamparan mengambang, bukan tab.

---

## 3. Bahasa visual

| `sect.css` | 2396 | seluruh sistem desain — token, tata letak, komponen, gerak |

| 64 token OKLCH | seluruh sistem desain
| `SectApp` (694 baris) | orkestrasi, socket, latensi soket (RTT), follow-mode, halaman masuk |
| `Hall` (218 baris) | aula, awan, Murid berdiri di denah, papan nama, "Tidak diketahui" saat belum masuk |
| `AmanatBoard` (161 baris) | papan amanat mengambang — lajur mendatar, backdrop redup |
| `stations` (135 baris) | peta stasiun per arketipe: koordinat lantai, skala kedalaman, urutan gambar |
| `EcoRail` (115 baris) | rail dua kantor: ruang, jumlah meja, lencana penghuni |
| `Chronicle` (123 baris) | Babad — catatan peristiwa |
| `QiRing` (92 baris) | cincin Tenaga, tiga keadaan |
| `Seal` (241 baris) | Segel — integritas rantai ledger |
| `Writ` (155 baris) | Titah — antrean persetujuan |
| `Warrant` (166 baris) | pintu masuk pemilik — token → cookie sesi |

### `QiRing` — tiga keadaan, bukan dua

| situasi | tampilan | alasan |
|---|---|---|
| belanja belum terukur | `—` | server tidak mengirim angka |
| pagu belum dikonfigurasi | `$1,25 · tanpa pagu` | belanja **diketahui**; hanya pagunya tidak ada |
| keduanya diketahui | `$2,50 / $10,00` | busur proporsional |

Versi pertama melipat dua situasi pertama menjadi satu `— — —`. `ratio: null`
dari `/burn` berarti "pagu belum dikonfigurasi", **bukan** "diredaksi" —
menyembunyikan belanja yang sudah diukur adalah pelanggaran prinsip 4.

Saat tak berpagu, busurnya `stroke-dasharray: 2 6` pada opacity 0,55: pola
putus-putus yang secara sengaja tidak menyiratkan proporsi apa pun.

### `Seal` (Segel) dan `Writ` (Titah) — dipulihkan

Keduanya **hilang** selama beberapa patch ketika UI sekte menggantikan chrome
lama: `AuditBadge` dan `ApprovalGate` ikut terhapus bersama stylesheet-nya,
dan tidak ada yang menyadarinya karena tidak ada gerbang yang mengukur fitur
yang lenyap. Keduanya dipulihkan di sini dalam idiom sekte.

**Segel** menampilkan kepala rantai dan hasil verifikasi. Dua perilaku diwarisi
dengan sengaja:

- **Tidak merender apa pun** begitu probe ditolak. Menampilkan tombol
  "verifikasi" yang mati justru mengiklankan keberadaan log audit yang tak
  bisa dibaca pemanggilnya.
- **Hash kepala ditampilkan utuh dan bisa diseleksi** (`user-select: all`).
  Memotongnya menghapus satu-satunya pertahanan terhadap pemangkasan ekor:
  operator menyalin hash ke tempat yang tidak dikuasai server ini.

Satu perilaku **tidak** diwarisi. Lencana lama melaporkan `verify.ok`, yaitu
integritas mata rantai saja. Server juga menghitung
`trustworthy = rantai ok DAN jangkar ok`, dan keduanya bisa berbeda. Komponen
ini melaporkan yang lebih lemah dan menyebut mana yang gagal:

> Rantai utuh (42 catatan), tetapi 2 jangkar tidak sepakat — jangan anggap
> tersegel

Kalimat di Segel yang merupakan klaim kepatuhan dan diperiksa mesin:

> Tahan-rusak, bukan anti-rusak

**Titah** menampilkan permohonan yang menunggu keputusan manusia. Aturannya:
*tidak ada kontrol yang dijamin 403* — bukan tombol yang dinonaktifkan,
melainkan tidak ada tombol sama sekali.

Dulu aturannya berbunyi "mengetahui ada yang menunggu bukan hak istimewa;
memutuskannya iya", dan kepemilikan disimpulkan dari payload (server
meredaksi `agent` dan `tool` untuk tamu). Dengan satu principal, membaca
antrean dan memutuskannya adalah standing yang sama: siapa pun yang bisa
membacanya adalah pemilik. Inferensi itu dibuang; `canApprove` kini bawaan
`true` dan pemanggil masih boleh menimpanya.

Baris hanya dihapus bila server menerima keputusan. Bila server menolak (409
kedaluwarsa, misalnya), barisnya tetap dan alasannya ditampilkan — menghapus
baris di situ akan merender keputusan yang tidak pernah terjadi.

### `Chronicle` (Babad)

- Auto-scroll **hanya** bila pembaca sudah di ekor. Menarik gulir dari bawah
  tangan orang yang sedang membaca riwayat adalah cara log audit berhenti
  dipakai.
- Jenis peristiwa tak dikenal **dirender**, bukan dibuang. `docs/EVENTS.md`
  mewajibkan klien mentoleransinya; mentoleransi bukan berarti menyembunyikan.
  Pembeli yang melihat peristiwa yang tak bisa dinamai UI belajar sesuatu yang
  benar tentang sistemnya.
- `channel_msg` menampilkan platform dan arah, **tidak pernah** isinya. Ini
  kontrak privasi, diuji langsung.

---

## 6. Aula

Delapan aula, nama dan pagu dari kebijakan server:

| ruang | nama | pagu/jam |
|---|---|---|
| `ceo-office` | Balai Sesepuh | $10 |
| `server-room` | Bilik Rajah | $5 |
| `mac-studio` | Bilik Ramuan | $3 |
| `main-office` | Gelanggang Latih | $2 |
| `meeting-room` | Balai Musyawarah | $1 |
| `lobby` | Gerbang Gunung | $0,25 |
| `kitchen` | Balai Santap | $0 |
| `nap-room` | Bilik Hening | $0 |

Nama Tionghoa selalu tampil **berdampingan** dengan glosa Inggris, tidak
menggantikannya.

### Pelat ruangan

Latar dihasilkan `scripts/stylize-donghua.py` dan dijaga `scripts/check-plates.py`
(tujuh aturan: ukuran kanvas, berat berkas, warna unik, luminans rata-rata,
persentil 5 dan 95, dan tinjauan magenta di luar palet).

Arah cahaya dipaku dan tidak boleh diubah sepihak — rake shader dan rim light
yang dipanggang harus sepakat atau ilusi kedalamannya runtuh:

```python
LIGHT_DX, LIGHT_DY = -2, -3
```

---

## 7. Gerak dan aksesibilitas

- **Kontras** dijaga gerbang 14 dalam APCA Lc, bukan rasio WCAG 2. Level:
  `body 75`, `secondary 60`, `critical 45`, `minimum 45`.
- **`prefers-reduced-motion`** direset dengan **3 `!important`** — ketiganya di
  dalam blok `@media (prefers-reduced-motion: reduce)` yang menihilkan durasi
  animasi dan transisi. Ini satu-satunya penggunaan `!important` yang sah di
  berkas ini, dan merupakan pola kanonik.
  Resetnya **menahan** awan, bukan menghapusnya: menghilangkan lapisan awan
  akan mengubah *apa* adegan itu, sedangkan menahannya hanya menghentikan
  geraknya.
- Rail adalah `<nav>` dengan label; tiap anak tangga `<button>` dengan
  `aria-current` dan `disabled` yang sesungguhnya — bukan sekadar bergaya
  nonaktif.
- Tabir memakai `role="alert"`.

---

## 8. Niu-mode

Palet LightVela, dinyalakan lewat pil `niu` di bilah atas atau perintah chat.
Preferensi disimpan di `localStorage` (`niu_mode`, default menyala; hanya
nilai `'0'` yang mematikan) bersama bahasa (`niu_mode_lang`, default `id`).

Sebelum patch 016 preferensi ini ditulis tetapi tidak pernah dibaca saat
muat — togglenya tampak bekerja lalu lupa. Satu patch setelah perbaikan itu,
penghapusan `hermes.css` nyaris mengulang kegagalan yang sama dalam bentuk
lain: kelas `body.niu-mode` tetap menempel di `<body>` sementara tidak ada
lagi aturan CSS yang menanggapinya. Karena itu paletnya **dipindahkan**, bukan
dibuang (lihat §3).

---

## 9. Apa yang dihapus dan mengapa

Penggantian ini menghapus 38 berkas `.ts/.tsx/.css` dari `frontend/src`. Semua
tidak terjangkau dari `main.tsx` — dibuktikan dengan penelusuran impor, bukan
dengan perasaan.

**Bundelnya tidak mengecil.** Vite sudah men-*tree-shake* berkas-berkas itu
sejak awal; CSS justru naik dari 14,9 kB ke 19,3 kB karena palet kedua dan dua
komponen tata kelola yang dipulihkan. Keuntungannya adalah pemeliharaan dan
kejujuran: tidak ada lagi 179 tes yang menguji komponen yang tak pernah
dirender pengguna.

Yang **tidak** boleh ikut terhapus, dan sempat hampir terhapus:

- `AtmosphereLayer.tsx` dan `BurnOverlay.tsx` terlihat "hidup" hanya karena
  satu impor **tipe**. Tipenya dipindahkan ke `hermes/burnTypes.ts` lebih
  dulu, barulah komponennya dihapus. Kontrak data tidak boleh tinggal di
  dalam komponen render — satu tampilan mati akhirnya menahan tiga modul
  hidup tetap tertambat padanya.
- `AuditBadge` dan `ApprovalGate` **fungsional** (memanggil `/ledger/verify`
  dan `/approvals`). Keduanya sempat terhapus dan dipulihkan sebagai Segel dan
  Titah. Pelajarannya tercatat di `handoff/LOG.md`: tidak ada satu pun dari 16
  gerbang yang menyadari dua permukaan tata kelola menghilang dari UI.
