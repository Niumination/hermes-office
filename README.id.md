# Hermes Office

[English](README.md) · **Bahasa Indonesia**

[![CI](https://github.com/Niumination/hermes-office/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/Niumination/hermes-office/actions/workflows/ci.yml)

**Tata kelola armada agen yang bisa Anda tunjukkan ke auditor.**

Denah lantai **adalah** kebijakannya. Setiap ruangan membawa daftar alat dan
aturan persetujuannya sendiri, dan ruangan yang belum dipakai ditandai
`idle`. Memindahkan agen antar ruangan mengubah apa yang boleh
ia lakukan — dan setiap perpindahan itu tercatat dalam rantai hash yang bisa
diverifikasi.

```bash
npm ci && (cd frontend && npm ci && npm run build)
bash scripts/demo.sh
```

Satu perintah menyalakan kantor sementara, menyemai 90 detik cerita yang bisa
dikenali siapa pun dari log mereka sendiri, lalu mencetak turnya.

---

## Masalah yang dibelinya

Satu angka, dan satu tanggal.

- **Kewajiban sistem berisiko-tinggi EU AI Act berlaku 2 Agustus 2026.**
  Pasal 12(1) menuntut pencatatan otomatis, Pasal 19 dan 26(6) menuntut
  retensi minimal enam bulan, Pasal 14 menuntut pengawasan manusia. Pasal
  99(4) menetapkan dendanya: **€15 juta atau 3% omzet global.**

Dua masalah pertama adalah soal uang yang hilang. Yang ketiga adalah soal
mampu membuktikan apa yang terjadi, berbulan-bulan kemudian, kepada orang yang
tidak memercayai Anda. Hermes Office dibangun untuk ketiganya sekaligus,
karena di lapangan ketiganya adalah satu kejadian yang sama: sebuah agen
melakukan sesuatu yang mahal, dan tidak ada yang bisa mengatakan dengan pasti
mengapa ia diizinkan.

## Apa yang sebenarnya Anda dapat

| | |
|---|---|
| **Denah lantai sebagai kebijakan** | Ruangan membawa aturan. `mac/sites` menolak `bash`/`deploy`/`kubectl`; `lightvela/infra` butuh persetujuan manusia untuk dimasuki; `mac/vault` berstatus `idle` dan menolak segalanya. Kebijakan yang bisa Anda tunjuk. |
| **Flight recorder tahan-rusak** | Setiap keputusan dirantai SHA-256, append-only. 0,020 ms per catatan; 100.000 catatan terverifikasi dalam 0,7 detik dan memakan 31,3 MB. |
| **Penambatan eksternal** | Rantai saja tidak mendeteksi pemotongan ekor. Hash kepala diterbitkan ke sink luar, jadi menghapus seratus catatan terakhir menjadi terlihat. Statusnya dilaporkan sebagai `none`/`local`/`remote` — tidak pernah diklaim lebih kuat dari kenyataannya. |
| **Time Machine** | Putar ulang rentang mana pun dari rantai. Agen punya **ruangan, bukan koordinat**: kalau rantai tidak mencatatnya, replay tidak mengarangnya. |
| **Standup** | Bacaan pagi berperingkat, deterministik, tanpa panggilan LLM. Malam yang tenang menghasilkan satu baris. |
| **Dossier kepatuhan** | Artefak yang dibaca asesor, dengan vonis verifikasinya sendiri di dalamnya. |

Dan ya — tampilannya bagus. Aula perguruan isometrik bergaya donghua, 12
ruangan, 18 pelat seni nyata. Itu bukan dekorasi: seluruh alasan denah lantai
dipakai sebagai kebijakan adalah supaya orang non-teknis bisa melihat postur
armada Anda dari seberang ruangan. Murid digambar sebagai tanda ber-aura qi,
bukan sprite karakter — sprite dipensiunkan 12 Okt 2026 (lihat
`docs/SPRITES.md`).

## Apa yang TIDAK dilakukannya

Daftar ini sama pentingnya dengan yang di atas, dan sengaja ada di muka.

- **Tidak membaca isi prompt Anda.** Tidak pernah, di jalur mana pun. Yang
  diproses adalah metadata tata kelola: siapa, alat apa, ruangan mana,
  diizinkan atau tidak.
- **Tidak bersaing dengan Agent View milik vendor.** Claude Code sudah
  mengirimkan tampilan "apa yang sedang berjalan" secara native sejak v2.1.139.
  Vendor akan selalu menang di sana. Produk ini soal **apa yang boleh
  berjalan, dan apa yang bisa Anda buktikan setelahnya.**
- **Bukan SaaS multi-tenant.** Ia berjalan di infrastruktur Anda, dengan data
  Anda, di SQLite yang bisa Anda salin.
- **Tahan-rusak, bukan anti-rusak.** Tertulis persis seperti itu di dalam
  UI-nya. Rantai hash membuat perubahan terdeteksi; ia tidak membuatnya
  mustahil. Siapa pun yang menjual Anda yang kedua sedang berbohong.

## Perbandingan jujur

Pasar observability LLM padat, dan sebagian besar jauh lebih besar dari ini.
Dulu di sini ada tabel tier harga pesaing; dihapus 2026-10-20 bersama semua
hal di repositori ini yang dinyatakan dalam uang.

Kalau yang Anda butuhkan adalah membandingkan dua prompt, pakai Langfuse. Alat
ini menjawab pertanyaan yang berbeda: *apa yang boleh dilakukan armada saya
tanpa saya, dan bisakah saya membuktikannya enam bulan lagi.*

## Arsitektur sekilas

```
Agen / bridge ──OTLP──┐
Hermes Cloud ─────────┼──► office-server ──► Browser (React, kantor isometrik)
Hermes Mac ───────────┘    Express 5 + ws        /auth   → satu-satunya pintu
                                 │               /standup → bacaan pagi
                    kebijakan ───┤               /replay  → time machine
                                 │               /dossier → bukti
                   flight rec ───┴─► SQLite (rantai hash) ──► jangkar eksternal
```

ESM, Node ≥ 22. Tanpa layanan eksternal, tanpa akun yang wajib, tanpa panggilan
keluar kecuali webhook jangkar yang Anda konfigurasikan sendiri.

Ingest lewat **OpenTelemetry GenAI semconv** — operasi `create_agent`,
`invoke_agent`, `execute_tool`, `retrieval`. Spesifikasi itu masih
*Development* dan framework memancarkan beberapa generasi atribut sekaligus,
jadi normalisasinya nyata dan sudah dikerjakan di sini.

## Jaminan mutu

| | |
|---|---|
| Test backend | **316** |
| Test frontend | **244** |
| Klaim dokumen yang diverifikasi mesin | **104** (`scripts/check-docs.py`) |
| Bundel | 295,3 kB JS · 44,0 kB CSS |
| CI | 4 job, sumber kanonik di `ci/workflow.yml` |

`check-docs.py` memeriksa dokumentasi terhadap repo — jumlah rute, jumlah
baris, jumlah aset, frasa pagar seperti *"Tidak pernah membaca isi prompt"*.
Dokumen yang berbohong tentang kode gagal di CI. Itu ada karena dokumen ini
adalah bagian dari apa yang dijual.

## Verifikasi sendiri

Tidak ada satu pun di atas yang meminta dipercaya begitu saja. Setiap angka di
halaman ini dihasilkan oleh sebuah perintah, dan perintahnya ikut dikirim
bersama repo:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office
npm ci
npm run verify
```

**20 gerbang, sekitar 4 menit** di mesin 2 inti. `npm run verify:fast`
melewati dua gerbang pembangunan ulang dan selesai sekitar satu menit. Exit
code 0 berarti semua gerbang lolos — dan tidak ada gerbang yang mencetak baris
hijau yang tidak ia dapatkan, karena setiap vonis berasal dari exit status
gerbang itu sendiri, bukan dari mencari kata di keluarannya. Versi lama
memutuskan lulus/gagal dengan mencari kata PASS, dan dengan riang melaporkan
"lint bersih" di atas dua error nyata.

| Gerbang | Yang dibuktikan |
|---|---|
| handoff integrity | setiap berkas cocok `MANIFEST.sha256` byte-for-byte; tanpa berkas liar |
| eslint | nol error lint di `server/` dan `tests/` |
| frontend build | `tsc && vite build` — error tipe gagal di sini |
| backend tests | 316 test |
| frontend tests | 170 test |
| clean shutdown | proses keluar bersih dengan WebSocket masih tersambung |
| ledger under load | rantai hash selamat dari 400 keputusan serentak: rapat, tanpa duplikat, verify ok |
| upstream assets | tak ada aset jatuh diam-diam; penghapusan sengaja tercatat beserta alasannya |
| ci workflow | workflow yang di-commit masih cocok dengan sumber kanoniknya |
| dependency pins | nol versi mengambang atau versi URL |
| sbom | `sbom.cdx.json` dibangun ulang dari lockfile dan cocok byte-for-byte |
| deployable | nol host atau alamat tailnet yang ditanam di kode |
| dev server routes | dev server menyala dan setiap rute backend diproxy |
| room plates | 26 pelat cocok hash **dan** aturan gaya rumah |
| theme contrast | 26 pasangan token diukur dalam APCA Lc, dihitung dari `oklch()` |
| doc claims | 94 klaim dokumen dieksekusi terhadap repo |
| bridge agents | jembatan cloud mengatribusikan event ke agen penyebabnya, bukan ke mesin |
| cast ids | setiap agen yang bisa dikirim jembatan digambar sebagai dirinya sendiri, dan tidak ada dua agen seruangan yang sama rupa |
| sprites (+rebuild) | 32 sprite cast dibangun ulang byte-for-byte, dan seninya terikat pada kode yang memuatnya |
| live site | situs yang berjalan menjawab, menyajikan halaman masuk tanpa mencetak sesi, menolak setiap rute data bagi pemanggil tanpa sesi, dan menyajikan bundel dari pohon ini |

Tiga di antaranya layak disebut khusus, karena merekalah yang menangkap apa
yang tidak bisa ditangkap hash:

- **sprites (+rebuild)** tidak membandingkan berkas dengan sidik jari yang
  direkam. Ia menjalankan ulang filter deterministik atas `art/originals/` dan
  menuntut byte yang sama kembali. Konstanta filter yang bergeser meninggalkan
  setiap berkas di disk tetap cocok dengan hash-nya sendiri; hanya pembangunan
  ulang yang menyadarinya.
- **doc claims** mengeksekusi prosa. Jumlah rute, jumlah baris, jumlah aset,
  ukuran bundel, dan frasa pagar seperti *"tidak pernah membaca isi prompt"*
  dibaca dari dokumen lalu dicocokkan ke repo.
- **upstream assets** membedakan aset yang jatuh dari pipeline dari aset yang
  sengaja dibuang — dan merah di kedua arah, jadi berkas yang dipulihkan dari
  riwayat Git tidak bisa kembali diam-diam.

Kalau ada gerbang merah pada klon bersih, itu cacat dan kami ingin laporannya.
Repo-nya adalah buktinya; bagian ini hanya daftar isinya.

## Dokumentasi

| Berkas | Isi |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modul, rute, keputusan |
| [`PRD.md`](docs/PRD.md) | Pilar produk, non-goal, roadmap |
| [`SECURITY.md`](docs/SECURITY.md) | Model token, auth satu-pemilik, coordinated disclosure |
| [`SUPPORT.md`](docs/SUPPORT.md) | Versi Node yang didukung, sampai kapan, dan apa arti "didukung" di sini |
| [`POLICY.md`](docs/POLICY.md) | Denah lantai sebagai kebijakan |
| [`FLIGHT-RECORDER.md`](docs/FLIGHT-RECORDER.md) | Rantai hash, penambatan, verifikasi |
| [`REPLAY.md`](docs/REPLAY.md) · [`STANDUP.md`](docs/STANDUP.md) | Dua permukaan turunan |
| [`OTLP.md`](docs/OTLP.md) · [`EVENTS.md`](docs/EVENTS.md) | Kontrak ingest |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Menjalankannya sungguhan |
| [`CHANGELOG-v2.md`](CHANGELOG-v2.md) | Setiap fase, termasuk yang gagal |

## Asal

Fork dari [Claude-Office](https://github.com/W17ant/Claude-Office) (MIT),
yang menyumbang kantor isometrik dan seninya. Semua lapisan tata
kelola — kebijakan, flight recorder, penambatan, replay,
standup — adalah karya baru di fork ini. README operasional asli diarsipkan di
[`docs/LEGACY-README.md`](docs/LEGACY-README.md).

Lisensi: MIT. Satu pemilik, satu token, tidak ada yang dijual.

Sebagian besar dokumen ditulis dalam bahasa Indonesia; README tersedia dalam
dua bahasa.

## Data Backup

Data runtime (database, logs) disimpan di repo private terpisah:

- **Repo Data**: `https://github.com/Niumination/hermes-office-data` (private)
- **Script Deploy**: `hermes-office-data/deploy.sh`

Untuk restore data ke server baru:
```bash
git clone https://github.com/Niumination/hermes-office.git
git clone git@github.com:Niumination/hermes-office-data.git
cd hermes-office
bash ../hermes-office-data/deploy.sh
```
