# Harga & paket

[English](PRICING.md) · **Bahasa Indonesia**

| | Gratis | Solo Pro | Team | Enterprise |
|---|---|---|---|---|
| | **$0** | **$39** sekali | **$299** sekali | **$2.000+**/tahun |
| | selamanya | lisensi abadi | lisensi abadi, ≤10 orang | kontrak |
| Kantor, kebijakan ruangan, burn-rate | ✅ | ✅ | ✅ | ✅ |
| Ingest OTLP, approval gate | ✅ | ✅ | ✅ | ✅ |
| Flight recorder (rantai hash) | ✅ | ✅ | ✅ | ✅ |
| Dossier kepatuhan | — | ✅ | ✅ | ✅ |
| Time Machine (replay) | — | ✅ | ✅ | ✅ |
| Mode kiosk, standup | — | ✅ | ✅ | ✅ |
| Penambatan eksternal (webhook) | — | — | ✅ | ✅ |
| Kebijakan kustom, tema | — | — | ✅ | ✅ |
| SSO, dukungan SLA | — | — | — | ✅ |
| Bantuan paket bukti audit | — | — | — | ✅ |

## Tidak pernah per kursi

Ini keputusan, bukan kelalaian, dan ia menolak uang di atas meja.

Alat tata kelola yang menagih per kursi menghukum Anda tepat ketika Anda
melakukan hal yang benar: mengundang petugas kepatuhan, memperlihatkan ke
penasihat hukum, memberi akses baca ke auditor eksternal, menempelkan layar di
dinding tempat seluruh perusahaan bisa melihatnya. Setiap kursi tambahan
membuat armada Anda **lebih** terkendali, dan menagihnya berarti menjual
produk yang berdebat melawan tujuannya sendiri.

LangSmith menagih $39/kursi ditambah per-trace. Laminar sudah pindah ke kursi
tak terbatas pada 2026, dan itu arah yang benar.

## Mengapa lisensi abadi, bukan langganan

Pembeli yang menginginkan ini tidak membeli layanan — mereka membeli
kemampuan membuktikan sesuatu nanti. Artefak yang buktinya lenyap saat
kartu kredit kedaluwarsa bukan bukti.

Rantai audit Anda adalah berkas SQLite di disk Anda. Dossier adalah Markdown.
Keduanya tetap bisa dibaca setelah kami hilang, dan itu bagian dari apa yang
Anda bayar. Langganan hanya untuk Enterprise, dan yang dibayar di situ adalah
dukungan dan SSO, bukan akses ke data Anda sendiri.

## Argumen untuk $2.000+

Pertanyaan yang benar bukan "apakah ini mahal", tapi "dibandingkan apa".

**Dibandingkan denda.** Pasal 99(4) EU AI Act: **€15 juta atau 3% omzet
global**, mana yang lebih tinggi. Pasal 12(1) menuntut pencatatan otomatis
sepanjang siklus hidup; Pasal 19 dan 26(6) menuntut log itu disimpan minimal
enam bulan. Kewajiban berisiko-tinggi sudah berlaku sejak **2 Agustus 2026.**
Alat ini tidak membuat Anda patuh — tidak ada perangkat lunak yang bisa — tapi
ia menghasilkan jenis artefak yang diminta pasal-pasal pencatatan itu, dalam
format yang bisa diverifikasi orang lain.

**Dibandingkan satu insiden.** 96% perusahaan melampaui proyeksi biaya AI
mereka, dan hanya 44% yang punya pagar pengaman (IDC, Des 2025). Satu agen
yang berputar dalam loop retry semalaman sudah melampaui angka ini. Standup
menemukan loop itu sebagai temuan bernama; pembatas anggaran menghentikannya
sebelum paginya.

**Dibandingkan membangunnya sendiri.** Rantai hash yang benar, redaksi yang
teruji, kontrak tamu yang tidak bocor di salah satu dari dua tempat, replay
deterministik yang bisa dipakai sebagai bukti. Itu bukan sprint. Repo ini
punya 407 test backend dan 115 klaim dokumen yang diverifikasi mesin justru
karena bagian-bagian ini mudah dibuat *hampir* benar.

**Dibandingkan pesaing.** Langfuse Enterprise $2.499/tahun untuk tracing dan
eval. Angka $2.000 bukan diskon terhadap mereka — ia produk berbeda di
kategori yang berdekatan, dan ia sengaja tidak lebih murah. Harga yang lebih
rendah akan memberi sinyal "alat bantu", padahal yang dibeli adalah bukti.

## Setiap angka di halaman ini bisa dieksekusi

Halaman harga adalah tempat klaim membusuk: ditulis sekali, dibaca semua
orang, diperiksa tidak oleh siapa pun. Yang ini tersambung ke repo.

Jumlah test, jumlah klaim, dan jumlah aset yang dikutip di sini dibaca dari
berkas ini oleh `scripts/check-docs.py` lalu dicocokkan dengan yang
benar-benar dilaporkan runner. Kalau halaman ini dan kodenya berbeda, CI
gagal. Versi Inggris dan Indonesia diikat ke angka yang sama, karena
terjemahan adalah tempat kedua bagi sebuah klaim untuk membusuk.

Anda juga tidak perlu memercayai itu begitu saja:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office && npm ci && npm run verify
```

18 gerbang, sekitar 4 menit di mesin 2 inti. Daftar gerbang dan apa yang
dibuktikan masing-masing ada di [README](../README.id.md#verifikasi-sendiri).

Inilah produk yang sebenarnya. Kantor isometrik bisa ditiru dalam seminggu;
vendor yang mempersilakan Anda mengeksekusi materi pemasarannya tidak bisa
ditiru sama sekali tanpa mengerjakan hal yang sama. Yang dijual seharga
$2.000+ bukan gambarnya — melainkan bahwa setiap kalimat yang menempel padanya
sudah dibuat dapat dibantah, dan dibiarkan begitu.

## Batas open-core

Inti MIT, dan tetap begitu: kantor, kebijakan ruangan, burn-rate, OTLP,
approval, dan **flight recorder**.

Rantai audit ada di tingkat gratis dengan sengaja. Memindahkan integritas
log ke balik paywall berarti menjual keselamatan kepada orang yang paling
mampu membayar, dan membuat proyek ini kehilangan hak untuk berargumen
seperti yang ia lakukan di `SECURITY.md`.

Yang berbayar adalah lapisan **artefak** — dossier, replay, kiosk,
standup — plus penambatan dan dukungan. Semuanya dibangun *di atas* rantai,
tidak satu pun diperlukan agar rantai itu benar.

## Yang tidak dijual

- **Akses ke data Anda.** Tidak ada telemetri keluar. Satu-satunya panggilan
  keluar adalah webhook jangkar yang Anda konfigurasikan sendiri.
- **Jaminan kepatuhan.** Kami menghasilkan bukti; asesor Anda menilainya.
  Disebut eksplisit, supaya tak perlu ditanyakan lewat email: tidak ada
  laporan SOC 2, tidak ada sertifikasi ISO 27001, tidak ada HIPAA BAA, tidak
  ada DPA bertanda tangan, tidak ada penetration test pihak ketiga. Yang ada
  adalah SBOM CycloneDX yang dibangun ulang setiap larian CI
  (`sbom.cdx.json`), ledger tahan-rusak, dan model ancaman terdokumentasi.
  Itu masukan bagi sebuah asesmen, bukan penggantinya.
- **Anti-rusak.** Tahan-rusak. Tertulis di UI-nya.
- **SLA uptime atau waktu tanggap.** Anda yang meng-hosting. Satu-satunya
  komitmen waktu di mana pun adalah jendela pengungkapan di
  [`SECURITY.md`](SECURITY.md#11-coordinated-disclosure), dan itu janji untuk
  menjawab, bukan janji untuk memperbaiki.
- **Dukungan untuk versi Node di luar matriks CI.** Himpunan yang didukung
  tepat dua versi dan terdaftar di [`SUPPORT.md`](SUPPORT.md).

Setiap butir di atas bisa dijual cukup dengan menulis satu kalimat. Tak satu
pun dijual, dan hanya karena itulah kalimat-kalimat di sisa halaman ini ada
harganya.
