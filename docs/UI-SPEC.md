# UI Spec — Hermes Office v2

**Status:** v2.0 · **Tanggal:** 6 Okt 2026

> **Menggantikan UI-SPEC v1 seluruhnya.** v1 menggambarkan kantor pixel-art
> yang digambar ke canvas. Keduanya salah sekarang: estetikanya **donghua 3D**
> dan render-nya **React DOM**, bukan canvas. §11 memuat daftar lengkap
> koreksinya.

---

## 1. Prinsip

1. **Denah lantai adalah kebijakan.** Kalau sesuatu dibatasi, batasan itu
   harus terlihat spasial. Sebuah ruangan bukan latar belakang — ia amplop
   aturan yang kebetulan punya lantai.
2. **Suhu sebelum angka.** Status anggaran sampai lewat warna seluruh ruangan
   sebelum ada yang perlu membaca digit.
3. **Kantor adalah bonus, bukan kanal tunggal.** Setiap event juga terbaca
   sebagai teks di panel. Tak ada informasi yang hanya hidup dalam animasi.
4. **Degradasi diam-diam.** Tanpa WebGL2, tanpa animasi, tanpa JS
   sekalipun — yang tersisa harus tetap masuk akal, bukan rusak.

---

## 2. Layout (desktop ≥1280 px)

```
┌──────────────────────────────────────────────────────────┐
│ TOPBAR  Hermes Office   [burn pill]  [audit badge]   ⚙   │
├───────────────────────────────────────────┬──────────────┤
│                                           │  AGENTS      │
│   ╔═══════════════════════════════════╗   │  ──────────  │
│   ║  .room-background  (pelat webp)   ║   │  ● cloud     │
│   ║  ─────────────────────────────    ║   │  ○ mac       │
│   ║  <AtmosphereLayer>  shader WebGL  ║   │  ● boss      │
│   ║  ─────────────────────────────    ║   ├──────────────┤
│   ║  furnitur (koordinat persen)      ║   │  CHAT /      │
│   ║  karakter + gelembung             ║   │  GITHUB      │
│   ╚═══════════════════════════════════╝   │  (tab)       │
│   [pita ruangan: trust · anggaran · alat] │              │
├───────────────────────────────────────────┴──────────────┤
│  <ApprovalGate>  muncul sebagai overlay saat diminta     │
└──────────────────────────────────────────────────────────┘
```

**Bukan canvas.** Setiap karakter dan perabot adalah elemen DOM yang
diposisikan dengan persentase relatif terhadap wadah ruangan. Konsekuensinya
nyata: bisa dipilih, bisa di-inspect, bisa di-style dengan CSS, dan bisa
dicapai pembaca layar — tapi berarti jumlah elemen adalah anggaran kinerja.

Mobile (<768 px): tampilan kantor selebar layar, panel menjadi bottom sheet.

### Tumpukan z-index

| z | Lapisan |
|---|---|
| 1 | `.room-background` — pelat webp |
| **2** | `.atmosphere-layer` — shader, `pointer-events:none`, `mix-blend-mode:screen` |
| 3+ | furnitur, lalu karakter (diurutkan per-baris), lalu gelembung |
| atas | overlay: `ApprovalGate`, `BurnOverlay` |

Shader duduk di **atas** pelat tapi di **bawah** segalanya yang hidup. Itu
alasan god ray-nya terasa seperti cahaya ruangan, bukan filter layar.

---

## 3. Bahasa Visual Donghua

Kesan 3D tidak datang dari geometri real-time. Ia datang dari **lima isyarat
cahaya** yang dipanggang ke dalam seni dan satu shader yang menyatukannya:

| Isyarat | Di mana |
|---|---|
| **Rim light** — isyarat paling mudah dikenali | dipanggang ke sprite oleh `stylize-donghua.py` |
| Specular mengkilap | dipanggang ke sprite |
| Ambient occlusion lembut | dipanggang ke sprite + bayangan kontak CSS |
| God ray volumetrik | shader |
| Debu melayang, 3 bidang parallax | shader |

Kunci sian datang dari **kiri atas** (`LIGHT_DX, LIGHT_DY = -2, -3`), isian
emas hangat dari arah berlawanan. Shader menyapu raknya dari sudut yang sama.
Kalau keduanya tidak sepakat, ilusinya runtuh seketika — ini satu-satunya
angka di dokumen ini yang tidak boleh diubah sepihak.

### Token warna (OKLCH)

19 token OKLCH di `frontend/src/styles/donghua.css`: triad **jade / emas /
tinta**, plus satu rona per burn state yang **dipakai bersama shader**.
Satu definisi, dua konsumen — CSS dan GLSL membaca nilai yang sama.

OKLCH dipilih karena interpolasi burn-state melewati warna perantara yang
masih enak dilihat; HSL berlumpur di jalur yang sama. Ini satu-satunya hal
yang diambil dari tumpukan UI 2026 — **tidak** ada migrasi Tailwind/shadcn
(PRD §11 D4).

### Urutan impor CSS

`donghua.css` diimpor **terakhir** di `HermesOfficeApp.tsx`, jadi ia menang
tanpa harus mengganti layout `office.css`. Biayanya **1 `!important`** yang
masih tersisa — utang yang diketahui, dicatat di ARCHITECTURE.md §11.

| Berkas | Baris | Peran |
|---|---|---|
| `office.css` | 1.582 | layout warisan, tata letak isometrik |
| `rooms.css` | 491 | per-ruangan |
| `hermes.css` | 232 | panel, chat |
| `donghua.css` | 176 | token + lapisan atmosfer + chrome |

---

## 4. Burn State sebagai Warna Ruangan

`OfficeStage` melakukan polling `/burn` tiap 5 detik dan menaruh
`data-burn={state}` pada `.office-view`. Satu atribut itu menggerakkan CSS
**dan** seragam shader.

| State | Rasio | Suasana ruangan |
|---|---|---|
| `normal` | <0,5 | sian tenang, god ray lembut |
| `warm` | <0,75 | amber merayap masuk |
| `hot` | <0,9 | oranye, debu memadat |
| `critical` | <1,0 | merah, kontras meninggi |
| `tripped` | ≥1,0 | biru dingin, ray padam — kantor "mati" |

**Tamu melihat warnanya, bukan uangnya.** `state` dan `ratio` memang sengaja
lolos redaksi tamu; nilai USD tidak. Jadi pengunjung anonim bisa melihat
kantor memerah tanpa belajar apa pun soal belanja Anda.

### Penyetelan per-ruangan

`rayStrength=0.15` untuk `server-room` dan `parking` — keduanya tanpa jendela,
jadi god ray penuh akan tampak konyol. `moteDensity=1.5` untuk `server-room`
(debu di berkas cahaya rak server).

---

## 5. Ruangan

12 ruangan, 18 pelat (varian siang/malam + @2x). Tiap ruangan menampilkan pita
yang membaca langsung dari kebijakan: **trust · anggaran/jam · alat yang
ditolak**. Pita itu bukan dekorasi — kalau `POLICY.md` berubah, pita berubah.

Ruangan dengan anggaran `0` (kitchen, nap-room) dirender sebagai zona idle dan
**menolak semua alat**. Secara visual tempat istirahat; secara mekanis sel
tahanan. Ambiguitas itu disengaja dan berguna.

---

## 6. Karakter

282 sprite, 4 arah hadap per karakter. Yang dirender hanya **8 arketipe
donghua** (32 sprite di `sprites/donghua/`); 150 sprite cast lama masih
dikirim tapi tidak dirujuk kode mana pun.

**Jangan pernah meregenerasi satu karakter sebagai 4 generasi terpisah** —
identitas melayang dan wajahnya berubah saat ia berbalik. Pola yang dipakai
cast donghua: hasilkan **depan + belakang saja**, lalu cerminkan untuk
kiri/kanan (`scripts/build-cast-sprites.py`). Ongkosnya diterima sadar —
atribut asimetris bertukar sisi saat dicerminkan (kepang `physician`, palu
`forge`) dan itu tidak terlihat pada 96 px. Untuk 150 sprite lama aturannya
tetap: restyle dari `art/originals/sprites/`, jangan buat ulang.

| Karakter | Perilaku |
|---|---|
| agent (per-role) | jalan dari pintu ke meja, kerja, istirahat kopi/air |
| boss | dapat Red Bull alih-alih kopi (bahkan saat istirahat minum air — lihat `agentManager.test.ts`) |
| cron-runner | berjalan ke meja target saat `cron_fired` |
| octo | muncul sebentar saat `git_push` |
| guest-ghost | hanya dirender kalau ada tamu online |

Efek di atas kepala dipetakan oleh `getEffect()` — bintang untuk karyawan
baru, jempol saat selesai, cangkir kopi, gelas air, kaleng energi untuk mode
ultra-think, dan `sleeping.webp` setelah **lebih dari** 30 detik idle. Semua
pemetaan itu dipasak 24 test.

---

## 7. Komponen Tata Kelola

### `BurnOverlay` (178 baris)
Pil anggaran persisten. Menampilkan dolar untuk owner, hanya state untuk tamu.

### `ApprovalGate` (171 baris)
Overlay saat persetujuan diminta: siapa, alat apa, ruangan mana, TTL
menghitung mundur dari 5 menit. Sekali pakai — setelah di-resolve, menekan
lagi memberi **409**, dan UI mengatakannya alih-alih diam.

Untuk tamu seluruh kartu diredaksi menjadi `{id, kind, room, status, dates}`
plus `redacted:true`. Dipasak oleh test yang **menyapu seluruh `innerHTML`**
untuk kata terlarang — kebocoran lewat atribut, `title`, atau `data-*` lolos
dari assertion per-field, jadi assertion per-field saja tidak cukup.

### `AuditBadge` (120 baris)
Mulai di `audit-unknown`, **bukan** `verified` — memegang hash kepala bukan
berarti rantai terverifikasi, dan lencana yang mulai hijau melatih orang
untuk tidak membacanya. Hilang sepenuhnya pada 401/403. Memuat kalimat
**"Tamper-evident, not tamper-proof."** secara harfiah, dan menautkan ke
`/dossier`.

Kalimat itu ada di test. Kalau seseorang menghapusnya demi pemasaran, build
gagal.

---

## 8. Gerak & Aksesibilitas

| Kondisi | Perilaku |
|---|---|
| Tanpa WebGL2 | `AtmosphereLayer` tidak merender apa pun; ruangan tetap tampil baik |
| Konteks WebGL hilang | ditangani, tidak crash |
| `prefers-reduced-motion` | waktu **dibekukan**, bukan dihapus — god ray tetap ada, hanya diam |
| Tab tersembunyi | `visibilitychange` menghentikan loop |
| DPR tinggi | dibatasi 1,5 |

Membekukan dan bukan menghapus itu penting: god ray **membawa burn state**.
Menghapusnya karena pengguna sensitif gerak akan menghapus informasi tata
kelola. Kami membuang animasinya, mempertahankan sinyalnya.

Sisanya: setiap event terbaca di panel teks; kontras WCAG AA pada panel;
`prefers-reduced-motion` juga mematikan animasi jalan karakter (pindah
langsung).

---

## 9. Niu-Mode

**Stub, bukan tema.** `frontend/src/hermes/niu.ts` menyediakan palet + string
Indonesia, persisten di `localStorage` kunci `niu_mode`, di-toggle lewat
perintah chat `/niu`.

UI-SPEC v1 menjanjikan papan nama, chatter, prop kopi Gayo, poster dinding,
dan music box gamelan. **Tidak ada satu pun yang dibangun.** Terdaftar di sini
sebagai belum-dibangun alih-alih dihapus diam-diam, karena menghapus janji
tanpa jejak adalah cara dokumen jadi tidak bisa dipercaya.

---

## 10. Inventaris Aset

| Aset | Jumlah | Catatan |
|---|---|---|
| Pelat ruangan | 18 | webp, varian siang/malam + @2x |
| Sprite | 282 | 4 arah hadap, nol placeholder (132 reproducible) |
| Original sprite | `art/originals/sprites/` 100 | **jangan pernah ditimpa** — sumber idempotensi `derived` |
| Render cast | `art/donghua-cast/` 16 | sumber reproduksi 32 sprite `built` |

`stylize-donghua.py` selalu membaca ulang dari `art/originals/sprites/` —
tidak pernah dari keluarannya sendiri — jadi menjalankan ulang tidak
menumpuk efek; original yang hilang adalah penghentian keras, bukan
peringatan. `check-assets.sh` memverifikasi semua 258 aset hulu terhitung,
karena direktori besar pernah hilang antar lingkungan. Kedua pohon sumber di
atas tidak dicakup skrip itu; keduanya dijaga `check-sprites.py`, yang
menurunkan sprite dari `derived`/`built` ke `unsourced` begitu sumbernya
lenyap.

Satu cacat yang diketahui: dinding `mac-studio-day` bergradasi pink→hijau.
Regenerasi ditawarkan, belum dikerjakan.

---

## 11. Koreksi terhadap v1

| v1 berkata | Kenyataan |
|---|---|
| "canvas ~70% width, tile grid" | **React DOM**, posisi persentase, bukan canvas |
| Pixel art | Donghua 3D (Fase 5) |
| Day/night sinkron WIB | Pelat siang/malam ada; burn state yang mendorong warna |
| Niu-mode tema penuh | Stub: palet + string + toggle `/niu` |
| Confetti saat double-click meja | Tidak dibangun |
| Music box lo-fi / gamelan | Tidak dibangun |
| Karakter "melambai + yes boss?" | Tidak dibangun |
| Printer jam → semua menoleh | Tidak dibangun |
| `prefers-reduced-motion` → matikan animasi | Diperluas: untuk shader, **bekukan waktu**, jangan hapus lapisannya |
| Tidak menyebut tata kelola sama sekali | `BurnOverlay`, `ApprovalGate`, `AuditBadge` kini komponen inti |

### Mengapa tinggal satu `!important`

Enam dari tujuh dicabut di Fase 15. Semuanya ternyata tidak pernah
diperlukan: `donghua.css` diimpor terakhir di `HermesOfficeApp.tsx` dan
selektornya persis sespesifik milik `office.css`, jadi urutan sumber saja
sudah menang. Flag itu dipasang "untuk jaga-jaga", dan lapisan tema yang
berteriak `!important` meninggalkan pelanggan yang me-reskin produk tanpa
tempat eskalasi lagi — persis meniadakan gunanya punya lapisan tema.

Yang bertahan satu: `transition: none` di dalam
`@media (prefers-reduced-motion: reduce)`. Itu beda jenis — jaminan
aksesibilitas, dan konvensinya memang membuatnya tak bisa ditimpa supaya
tidak ada aturan baru yang mengembalikan gerak bagi orang yang memintanya
berhenti. Ia juga satu-satunya yang tidak bisa diuji di sini, karena jsdom
tidak mengevaluasi `@media`.

Dijaga `frontend/src/styles/cascade.test.ts`, yang membangun dua dokumen —
satu tanpa lapisan tema, satu dengan — lalu menuntut properti chrome tiap
panel berubah. Itu klaim yang lebih lemah daripada "tampilannya benar", dan
itu klaim yang jujur: unit test tidak bisa melihat. Yang ia buktikan adalah
hal yang akan diam-diam rusak — bahwa tema masih sampai ke elemennya.
