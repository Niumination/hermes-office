# Plate ruangan — provenance dan penerimaan

## Koreksi lebih dulu

Dua klaim yang pernah ditulis di repo ini tentang seni ruangan **salah**, dan
keduanya ditulis dengan percaya diri:

1. *"`art-backup/rooms/` adalah asli murni, jangan pernah ditimpa."* — Benar
   untuk empat berkas. Untuk dua belas lainnya, "asli"-nya adalah **seni
   placeholder**: persegi panjang datar dengan tulisan seperti
   `MEETING ROOM / PLACEHOLDER ART` di tengahnya.
2. *"Ada celah reproduksibilitas: 18 plate tidak bisa diregenerasi dari
   `art-backup` karena pipeline restyle-nya tak pernah disimpan sebagai
   skrip."* — Tidak ada pipeline untuk dipulihkan. **Tidak ada filter yang
   bisa menghasilkan plate-plate ini dari placeholder itu.** Seninya
   *dihasilkan*, bukan *diturunkan*.

Keduanya hanya terbongkar dengan membuka berkasnya dan melihat. Pola yang
sama berulang di proyek ini: klaim tentang aset yang tidak pernah dieksekusi
apa pun.

| | berkas | asal |
|---|---|---|
| Upstream asli | `office-day`, `office-night`, + varian `@2x` | seni Claude-Office (MIT) |
| Dihasilkan | 12 plate 1600×1200 + 2 pelat `-dm` | dibuat untuk fork ini |

Pembedanya mekanis: plate jadi punya **1711+ warna unik** pada sampel 60×45;
placeholder berhenti di **377**.

## Tujuan yang benar

Karena generasi tidak deterministik, "buat ia reproducible" bukan tujuan
yang bisa dicapai. Yang bisa:

> **Anda tidak bisa mereproduksi seni yang dihasilkan.
> Anda bisa mereproduksi penilaian apakah sebuah plate pantas masuk.**

`scripts/check-plates.py` adalah penilaian itu dalam bentuk yang dijalankan.

## Tiga lubang yang ditutup

**Integritas.** `check-assets.sh` hanya memastikan ada berkas dengan nama
yang benar. Ia tidak mengatakan apa pun tentang isinya: plate yang terpotong
nol byte, tertukar dengan ruangan lain, atau diam-diam di-reencode setengah
resolusi semuanya lolos. Dua plate sudah pernah hilang di proyek ini tanpa
ada yang sadar. Hash menutup itu.

**Provenance.** Tidak ada yang mencatat mana yang upstream dan mana yang
dihasilkan — itulah sebabnya klaim "asli murni" di atas bisa bertahan lama.
`frontend/public/rooms/PLATES.json` kini menyatakannya per plate.

**Perluasan.** "Custom policy, theming" adalah fitur tier berbayar. Pelanggan
yang menambah ruangan perlu tahu apa yang membuat sebuah plate pantas. Ambang
di bawah adalah jawabannya.

## Kriteria penerimaan

Setiap ambang **diukur dari korpus 18 plate yang ada**, lalu dilonggarkan ke
angka bulat terdekat. Tidak ada yang dikarang.

| Aturan | Batas | Menangkap |
|---|---|---|
| Kanvas | 1600×1200 (ruangan baru) | geometri salah |
| Berkas | 40–320 kB | terpotong, atau jauh lebih berat dari korpus |
| Warna unik @60×45 | ≥ 900 | **seni placeholder** |
| Luminansi rata-rata | 0,18–0,62 | terlalu gelap / terlalu terang |
| Persentil-5 | ≤ 0,32 | tidak ada yang gelap di frame |
| Persentil-95 | ≥ 0,45 | tidak ada yang tersinari |
| Off-palette (magenta 290–350°) | > 3% wajib ditinjau | siraman pencahayaan nyasar |

Ambang warna unik duduk di celah lebar: placeholder maksimum 377, plate asli
minimum 1711, garis di 900.

## Off-palette ditandai, bukan ditolak

Pemindaian magenta akan menolak `nap-wellness-room` (12,2%) dan
`office-night-dm` (17,7%) — dan keduanya benar. Yang pertama suasana malam
ungu yang disengaja, yang kedua langit senja di balik jendela. Fase 15 nyaris
"memperbaiki" keduanya sebelum membukanya.

Jadi konten off-palette menuntut catatan `offPaletteReviewed` eksplisit di
manifest, bukan diloloskan diam-diam dan bukan ditolak diam-diam.
**Pemindai adalah daftar pendek; manusia adalah vonisnya.**

## Menambah ruangan

```bash
# 1. buat plate 1600x1200. Cangkang kosong — perabot dikomposit di atasnya
#    pada koordinat persentase, jadi jangan menggambar agen atau furnitur
#    yang akan ditimpa.
# 2. periksa sebelum memasukkannya:
python3 scripts/check-plates.py --candidate kamar-baru.webp

# 3. kalau lolos, taruh di frontend/public/rooms/ lalu daftarkan:
python3 scripts/check-plates.py --write
git add frontend/public/rooms/
```

Bahasa gayanya, untuk dicocokkan: isometrik, dinding dua sisi terbuka ke
kamera, rim light jade di tepi lantai, cahaya kunci hangat dari jendela atau
lampu praktis, bayangan kontak tajam, kaca berpendar untuk layar, trim logam
halus. Arah cahaya harus setuju dengan `LIGHT_DX, LIGHT_DY` di
`scripts/stylize-donghua.py` — kalau tidak, karakter yang berdiri di ruangan
itu terlihat ditempel.

## Menjalankan pemeriksanya

```bash
python3 scripts/check-plates.py             # verifikasi hash + gaya
python3 scripts/check-plates.py --write     # daftarkan ulang setelah perubahan sah
python3 scripts/check-plates.py --candidate X.webp
```

Perubahan sah **harus** disertai `--write` dan manifest yang di-commit. Itu
disengaja: mengubah seni jadi tindakan yang terlihat di diff, bukan sesuatu
yang menyelinap lewat.
