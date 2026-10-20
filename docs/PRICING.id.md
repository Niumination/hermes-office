# Harga & paket

[English](PRICING.md) · **Bahasa Indonesia**

Tidak ada tier, tidak ada kursi, tidak ada daftar harga. Ini kantor satu
orang, di-host sendiri, MIT, dan setiap permukaannya menjawab satu token
pemilik.

Itu sebuah pencabutan. Halaman ini dulu memuat empat tier — Gratis $0, Solo
Pro $39, Team $299, Enterprise $2.000+ — dengan dossier, replay, kiosk, dan
standup ditahan di balik yang berbayar, plus argumen panjang kenapa $2.000
adalah angka yang benar dibanding denda EU AI Act. Argumennya koheren. Ia
juga menggambarkan produk yang punya pelanggan, kontrak dukungan, dan paket
Team untuk sepuluh orang — yang tak satu pun ada.

Ongkos berpura-pura itu bukan sekadar malu. Tier Gratis menyiratkan adanya
pengunjung yang bukan pembeli, dan justru dari situlah peran tamu lahir:
sesi read-only yang dicetak otomatis supaya calon pembeli bisa melihat
kantor tanpa token, lalu pipeline redaksi di belasan berkas supaya sesi itu
tidak membaca apa pun yang nyata. Bentuk produk yang tak diminta siapa pun
menumbuhkan batas keamanan yang tak dibutuhkan siapa pun, dan batas itu
sempat bocor sekali sebelum dicabut. Paketnya bukan hiasan — ia menopang
beban, ke arah yang salah.

Yang tersisa adalah yang benar: intinya MIT, rantai audit adalah berkas
SQLite di disk Anda sendiri, dossier berupa Markdown, tidak ada telemetry
keluar, dan tidak ada yang kedaluwarsa. Bukan karena itu positioning yang
murah hati, melainkan karena tidak ada mekanisme di repositori ini yang bisa
berbuat lain.

## Setiap angka di halaman ini bisa dieksekusi

Halaman harga adalah tempat klaim membusuk: ditulis sekali, dibaca semua
orang, diperiksa tidak oleh siapa pun. Yang ini tertambat ke repositori, dan
tetap tertambat setelah harganya dihapus — pemeriksanya tidak peduli kalimat
ini menjual apa, hanya apakah benar.

Jumlah test, jumlah klaim, dan jumlah aset yang dikutip di sini dibaca dari
berkas ini oleh `scripts/check-docs.py` dan dibandingkan dengan laporan
runner sungguhan. Bila halaman ini dan kodenya berselisih, CI gagal. Versi
Inggris dan Indonesia diikat ke angka yang sama, karena terjemahan adalah
tempat kedua bagi klaim untuk membusuk.

Repo ini punya 402 test backend dan 119 klaim dokumen yang diverifikasi mesin,
justru karena rantai hash yang benar, otorisasi yang bertahan di REST
**dan** WebSocket alih-alih di salah satu dari dua tempatnya, serta replay
deterministik yang layak jadi bukti semuanya mudah dibuat *nyaris* benar.

Anda juga tidak perlu memercayainya begitu saja:

```bash
git clone https://github.com/Niumination/hermes-office
cd hermes-office && npm ci && npm run verify
```

18 gerbang, sekitar 4 menit di mesin 2 inti. Daftar gerbang dan apa yang
dibuktikan masing-masing ada di [README](../README.id.md#verifikasi-sendiri).

Kantor isometrik bisa disalin dalam sepekan. Yang tidak bisa disalin tanpa
mengerjakan hal yang sama adalah pohon kode yang setiap kalimat terlampirnya
sudah dibuat dapat difalsifikasi, dan dibiarkan begitu. Sifat itulah
intinya, dan ia selamat dari penghapusan tier — ia memang bukan yang
dijual tier.

## Jangan pernah per-kursi

Dipertahankan sebagai aturan meski tak ada yang ditagih, karena inilah hal
yang paling mungkin ditemukan ulang begitu ada.

Alat tata kelola yang menagih per kursi menghukum Anda tepat saat Anda
melakukan hal yang benar: mengundang petugas kepatuhan, memperlihatkan ke
legal, memberi auditor eksternal akses baca. Setiap pembaca tambahan membuat
armada **lebih** terkelola, dan menagihnya berarti mengirim produk yang
membantah tujuannya sendiri.

Perhatikan bentuk kesalahan yang sudah dibuat repo ini ke arah sebaliknya.
"Biarkan satu pembaca tambahan masuk gratis" menjadi sesi tamu otomatis,
menjadi pipeline redaksi, menjadi satu-satunya hal yang berdiri antara
tunnel publik dan anggaran armada. Tidak menagih pembaca itu benar. Tidak
berarti pembaca boleh bebas tanpa autentikasi.

## Kenapa tidak ada yang kedaluwarsa

Alasan menjalankan ini bukan membeli layanan — melainkan agar bisa
membuktikan sesuatu nanti. Artefak yang buktinya lenyap saat kartu kredit
kedaluwarsa bukanlah bukti.

Rantai audit Anda adalah berkas SQLite di disk Anda. Dossier-nya Markdown.
Keduanya tetap terbaca setelah repositori ini tiada.

## Tidak ada lagi batas open-core

Dulu ada. Kantor, kebijakan ruangan, burn-rate, OTLP, approval, dan perekam
penerbangan bersifat MIT; dossier, replay, kiosk, dan standup adalah lapisan
artefak berbayar. Sekarang semuanya MIT — yang memang selalu tertulis di
berkas lisensi — dan kiosk sudah tidak ada sama sekali.

Menjaga integritas log keluar dari paruh berbayar adalah satu-satunya bagian
dari pemisahan itu yang layak dipertahankan sebagai aturan, bukan tier:
menaruhnya di balik paywall berarti menjual keselamatan kepada yang paling
mampu membayar, dan akan merenggut hak proyek ini berargumen seperti yang
dilakukannya di `SECURITY.md`.

## Klaim yang dulu dibuat halaman ini

Versi lama mengadu tier $2.000-nya dengan EU AI Act Pasal 99(4) — **EUR 15
juta atau 3% omzet global** — dan dengan Pasal 12(1) yang mewajibkan logging
otomatis sepanjang siklus hidup, serta Pasal 19 dan 26(6) yang mewajibkan
log itu disimpan minimal enam bulan. Kewajiban risiko-tinggi berlaku sejak
**2 Agustus 2026**.

Pasal-pasal itu tetap nyata dan tetap jadi alasan perekam penerbangan
dibangun seperti sekarang. Yang keliru adalah kesimpulan tersiratnya. Alat
ini tidak membuat siapa pun patuh — tidak ada perangkat lunak yang bisa — dan
menempelkan harga pada paragraf itu membuatnya terbaca seolah bisa.

## Yang tidak dijual

Tidak ada yang dijual. Daftar ini dipertahankan karena setiap butirnya
adalah kalimat yang cepat atau lambat akan menggoda seseorang untuk ditulis.

- **Akses ke data Anda.** Tanpa telemetry keluar. Satu-satunya panggilan
  keluar adalah webhook penambat yang Anda konfigurasi sendiri.
- **Jaminan kepatuhan.** Kami menghasilkan bukti; asesor Anda yang menilai.
  Disebut eksplisit supaya tak perlu ditanya lewat surel: tidak ada laporan
  SOC 2, tidak ada sertifikasi ISO 27001, tidak ada HIPAA BAA, tidak ada DPA
  bertanda tangan, tidak ada uji penetrasi pihak ketiga. Yang ada adalah SBOM
  CycloneDX yang dibangun ulang tiap CI (`sbom.cdx.json`), ledger yang
  tamper-evident, dan model ancaman yang terdokumentasi. Itu masukan untuk
  asesmen, bukan penggantinya.
- **Tamper-proof.** Tamper-evident. Tertulis begitu di UI.
- **SLA uptime atau waktu respons.** Anda yang meng-host. Satu-satunya
  komitmen waktu yang dibuat di mana pun adalah jendela disclosure di
  [`SECURITY.md`](SECURITY.md#11-coordinated-disclosure), dan itu janji untuk
  menjawab, bukan janji untuk memperbaiki.
- **Dukungan untuk versi Node di luar matriks CI.** Himpunan yang didukung
  persis dua versi dan tercantum di [`SUPPORT.md`](SUPPORT.md).
