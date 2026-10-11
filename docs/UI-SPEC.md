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

1. **Tataran = izin.** Ketinggian di layar adalah tingkat kepercayaan. Aula yang
   lebih tinggi butuh Tataran lebih tinggi. Ini bukan metafora dekoratif: rail
   diurutkan langsung dari tangga kebijakan server.
2. **Tenaga = burn.** Belanja adalah energi yang mengalir, bukan angka di pojok.
   Lima keadaan server (`normal → warm → hot → critical → tripped`) menjadi
   lima warna qi.
3. **Lenyap di Balik Kabut = 403.** Aula yang tidak boleh dimasuki tertutup awan. Tabir
   hanya muncul bila server memang menolak.
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
│  rail Tataran    │          aula (hall)            │  Titah (writ)     │
│                  │                                 │  ──────────────   │
│  Balai Sesepuh ··│  pelat sinematik + 2 awan +     │  Babad (chronicle)│
│  Bilik Rajah   · │  grade + vignette               │  / roster Murid   │
│  Bilik Ramuan    │  Murid sebagai aura qi          │                   │
│  …               │  tabir bila terkunci            │  auto-scroll      │
│  Gerbang Gunung  │                                 │  hanya di ekor    │
└──────────────────┴─────────────────────────────────┴───────────────────┘
```

Grid tiga kolom. Rail memakai `flex-direction: column-reverse` sehingga aula
berperingkat tertinggi berada di atas secara harfiah — urutan DOM tetap dari
rendah ke tinggi agar pembaca layar menyusurinya sesuai tangga kebijakan.

**Breakpoint.** 1180 px (rail menyempit), 860 px (kolom bertumpuk).

---

## 3. Bahasa visual

Satu stylesheet: `frontend/src/styles/sect.css`.

| berkas | baris | peran |
|---|---|---|
| `sect.css` | 1024 | seluruh sistem desain — token, tata letak, komponen, gerak |

Versi v1 mengimpor lima stylesheet (`office.css`, `rooms.css`, `donghua.css`,
`hermes.css`, dan satu lagi lewat `@import`), menghasilkan empat generasi token
yang saling menimpa. Semuanya sudah dihapus. Satu `@import` font di baris
pertama CSS juga dihapus: ia memblokir render secara berantai.

### Token warna (OKLCH)

**35 token OKLCH** di `sect.css`. OKLCH dipilih karena lightness-nya
perseptual — menaikkan `L` menaikkan kontras terbaca, yang membuat perbaikan
APCA bisa dicari secara sistematis alih-alih ditebak.

Tangga tinta lima anak tangga (`--sect-ink-0` … `--sect-ink-4`), tiga warna
teks (`--sect-paper`, `--sect-mist`, `--sect-jade`), satu perhatian
(`--sect-gold`), satu bahaya (`--sect-cinnabar`), lima qi (`--sect-qi-0` …
`--sect-qi-4`).

> **Catatan gamut.** `--sect-cinnabar` tidak bisa diperbaiki hanya dengan
> menaikkan lightness: ia keluar gamut sRGB sebelum mencapai ambang APCA.
> Nilainya (`oklch(70.5% 0.185 28)`) adalah hasil sapuan dua sumbu L×C yang
> mencari chroma tertinggi yang masih lulus. Gerbang 14 menolak warna di luar
> gamut, karena browser akan memotongnya ke warna yang tidak pernah diukur.

### Dua palet

`:root` adalah palet default. `body.niu-mode` menyatakan ulang lima anak
tangga tinta (digeser ke hijau giok) dan satu aksen (ember). Tangga
lightness-nya **sengaja identik** dengan default: kontras adalah fungsi
lightness, jadi menyamakan tangga membuat palet niu mewarisi kelonggaran APCA
default alih-alih harus mendapatkannya lagi secara kebetulan.

Gerbang 14 tetap mengukur ketiga belas pasangan di **kedua** palet — 26
pengukuran. Palet yang bisa dicapai pengguna dengan satu perintah adalah palet
yang harus terbaca.

---

## 4. Burn sebagai qi

| keadaan server | Tenaga | warna |
|---|---|---|
| `normal` | Atur Napas regulated | `--sect-qi-0` |
| `warm` | Himpun Tenaga gathering | `--sect-qi-1` |
| `hot` | Tenaga Meluap surging | `--sect-qi-2` |
| `critical` | Tenaga Berbalik reversal | `--sect-qi-3` |
| `tripped` | Salah Jalan deviation | `--sect-qi-4` |

Pemetaan ini `Record<BurnState, QiName>` yang total. Menambah keadaan keenam di
server akan menggagalkan type-check, bukan merender kosong.

Qi tampil di dua tempat: cincin di bilah atas, dan aura tiap Murid di aula.

---

## 5. Komponen

| komponen | baris | peran |
|---|---|---|
| `SectApp` (330 baris) | orkestrasi, socket, follow-mode, bootstrap tamu |
| `Hall` (112 baris) | aula, awan, Murid, tabir Lenyap di Balik Kabut |
| `RealmRail` (80 baris) | tangga Tataran, kehadiran, pagu |
| `Chronicle` (108 baris) | Babad — catatan peristiwa |
| `QiRing` (95 baris) | cincin Tenaga, tiga keadaan |
| `Seal` (168 baris) | Segel — integritas rantai ledger |
| `Writ` (164 baris) | Titah — antrean persetujuan |

### `QiRing` — tiga keadaan, bukan dua

| situasi | tampilan | alasan |
|---|---|---|
| tamu, diredaksi | `Tamu · diredaksi` | server tidak mengirim angka |
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
  "verifikasi" yang mati kepada tamu justru mengiklankan keberadaan log audit
  yang tak boleh ia baca.
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
*mengetahui ada yang menunggu bukan hak istimewa; memutuskannya iya.* Tamu
melihat antrean tanpa tombol — bukan tombol yang dinonaktifkan, melainkan
tidak ada tombol. Kepemilikan disimpulkan dari payload itu sendiri (server
meredaksi `agent` dan `tool` untuk tamu), sehingga tidak ada kontrol yang
dijamin 403.

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
