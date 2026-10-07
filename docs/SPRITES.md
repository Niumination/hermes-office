# Sprite — asal, reproduksi, dan satu hal yang belum selesai

Dokumen pendamping [`ROOM-PLATES.md`](ROOM-PLATES.md). Keduanya menjawab
pertanyaan yang sama — "apakah aset ini yang kami kira?" — tapi sprite bisa
menjawabnya jauh lebih kuat, karena sprite **bisa dibangun ulang**.

## Perbedaan pentingnya

Plate ruangan dihasilkan, dan generasi tidak deterministik. Yang bisa dijamin
hanya sidik jari: "byte ini sama dengan byte yang kami rekam".

Sprite berbeda. Seratus tiga puluh dua sprite diproduksi oleh langkah
deterministik dari sumber yang masih ada, jadi jaminannya naik satu tingkat:

> **Bangun ulang dari sumber, dan hasilnya harus cocok byte-for-byte.**

`python3 scripts/check-sprites.py --regen` melakukan itu untuk 132 sprite,
sekitar dua setengah menit. Itu satu-satunya hal yang bisa menangkap resep
yang bergeser — konstanta filter yang digeser, pencerminan yang dibalik —
karena saat itu setiap berkas di disk masih cocok dengan hash-nya.

## Empat populasi

| | jumlah | artinya |
|---|---|---|
| `derived` | 100 | punya original di `art/originals/sprites`, dan berkas yang dikirim persis `stylize(original)` |
| `built` | 32 | cast donghua: persis `build-cast-sprites(art/donghua-cast/)` — ukur ulang + cermin, keduanya deterministik |
| `opaque` | 0 | punya original tanpa alpha, sengaja dilewati filter |
| `unsourced` | 150 | **tidak ada sumber. Belum pernah melewati pipeline apa pun.** |

Tercatat di `frontend/public/sprites/SPRITES.json`.

Dua kategori reproducible itu berbeda bahan, bukan hanya berbeda nama.
`derived` membangun ulang dari seni yang digambar manusia; `built` membangun
ulang dari delapan render yang **dihasilkan**, dan generasi tidak
deterministik. Jadi reproducibility cast berhenti satu lapis lebih awal:
32 sprite kirim bisa dibuktikan berasal dari 16 render di
`art/donghua-cast/`, tapi ke-16 render itu sendiri hanya dilindungi hash,
persis seperti plate ruangan. Hilangkan direktori itu dan castnya jadi
`unsourced` — yang memang terjadi, dan memang gagal (lihat tabel mutasi).

## Yang belum selesai: 150 sprite itu adalah seluruh cast lama

Ini bukan selisih pembulatan. Seluruh 150 sprite tanpa sumber adalah
**setiap karakter dari cast lama** — 108 di `office/characters`, 42 di `characters/`.

Docstring `stylize-donghua.py` membuka dengan kalimat bahwa ia menata "108
sprites: 27 characters x 4 facings". `office/characters` memuat tepat 108
berkas. Tidak satu pun pernah melewati filter.

Buktinya rapat, dan tidak bergantung pada penilaian mata: pipeline menyalin
setiap berkas yang disentuhnya ke pohon original **sebelum** menyentuhnya,
dan pohon itu tidak memuat satu pun karakter. Seluruh pass donghua —
rim light, ambient occlusion, specular, grade hangat, keyline — mendarat di
properti, kucing, efek, furnitur, dan dekorasi. Fitur visual utamanya tidak
pernah menyentuh castnya.

Memperbaikinya adalah keputusan seni, bukan keputusan teknis: ia mengubah
tampilan setiap karakter di produk. Jalurnya sudah siap kalau diputuskan jalan
(`--adopt` untuk mendaftarkan 150 original, lalu jalankan pipeline), tapi
manifest tidak akan berpura-pura celah itu tidak ada sementara itu.

**Yang kemudian terjadi: celah itu tidak ditambal, cast-nya diganti.** Aplikasi
sekarang merender 8 arketipe donghua dari `sprites/donghua/`, dan
`grep` ke `frontend/src` mengembalikan **nol** rujukan ke `office/characters`
maupun `characters/`. Jadi 150 sprite `unsourced` itu kini punya status yang
lebih tepat daripada "belum difilter": mereka **tidak dirender oleh apa pun**.

Mereka tetap dikirim, dan itu disengaja — swap kembali adalah satu path di
`Character.tsx`, jadi keputusan seni ini reversibel dalam satu baris selama
berkasnya masih ada. Tapi dua konsekuensinya dicatat di sini, bukan
ditemukan nanti:

1. **Bobot mati.** Build memuat 150 berkas yang tak pernah diminta browser.
2. **Liabilitas HKI.** Ke-108 sprite `office/characters` adalah rupa yang
   dapat dikenali dari sebuah serial televisi, di dalam produk berharga
   $2.000+. Cast donghua orisinal ada sebagian besar untuk alasan itu.
   Menghapus direktori lama menutup paparannya; menyimpannya menjaga jalur
   mundur. Itu pilihan komersial, dan belum diambil.

## Cacat yang menghancurkan seni pelanggan

Sampai fase ini, `stylize-donghua.py` menyimpan pohon originalnya di path
absolut: `/home/user/art-backup/sprites`. Direktori itu ada di tepat satu
mesin dan di nol clone repo ini.

Di mesin lain, alurnya begini: path tidak ada → skrip menganggap sprite
**yang sudah ber-filter** sebagai original murni → menyalinnya ke pohon
original → menerapkan filter kedua kali → menimpa seninya. Original sejatinya
hilang, hasil rusaknya kini terdaftar sebagai sumber kebenaran, dan skripnya
mencetak `originals preserved` sambil melakukannya.

Diverifikasi dengan menjalankannya sebagai pelanggan: 250 sprite rusak,
tidak bisa dipulihkan, tanpa satu pun peringatan.

Sekarang: original tinggal di dalam repo (`art/originals/sprites`, 13 MB),
original yang hilang adalah **penghentian keras**, dan mengadopsi berkas
sebagai originalnya sendiri butuh `--adopt` eksplisit dan dihitung di output.

```
FAIL: no originals tree at ...
  This script restyles from pristine originals, never from its own
  output. Without them it would filter the shipped art a second time
  and overwrite it.
```

## Perintah

```bash
python3 scripts/check-sprites.py           # hash + provenance, milidetik
python3 scripts/check-sprites.py --regen   # + bangun ulang 132 (100 derived + 32 built), ~2,5 mnt
python3 scripts/check-sprites.py --write   # rekam ulang setelah perubahan sah
python3 scripts/stylize-donghua.py         # terapkan filter dari original
SPRITE_ORIGINALS=/path python3 scripts/stylize-donghua.py   # original di luar repo

python3 scripts/cutout-cast.py art/donghua-cast/front-256   # latar -> alpha (flood fill dari tepi)
python3 scripts/build-cast-sprites.py                       # 16 render -> 32 sprite 4 arah
python3 scripts/build-cast-sprites.py --out /tmp/verify      # tulis ke scratch, jangan timpa seni
```

## Apa yang ditangkap apa

Sebelas mutasi diuji; semua tertangkap. Pembagian kerjanya disengaja:

| Mutasi | Jalur cepat | `--regen` |
|---|---|---|
| sprite hilang / tak terdaftar / terpotong / tertukar | ✅ | ✅ |
| original hilang (derived → unsourced) | ✅ | ✅ |
| **original dirusak**, berkas kirim tetap sah | ✅ | ✅ |
| render cast hilang (built → unsourced) | ✅ | ✅ |
| **render cast dirusak**, berkas kirim tetap sah | ✅ | ✅ |
| **konstanta filter digeser** | ❌ | ✅ |
| **pencerminan builder dibalik** | ❌ | ✅ |

Baris ketiga sempat jadi celah. `originalSha256` sudah direkam tapi tidak
pernah dibandingkan di jalur cepat, jadi kerusakan sumber hanya terdeteksi
setelah dua menit membangun ulang. Hash-nya sudah ada; membandingkannya gratis.

Dua baris terakhir tidak bisa ditutup dengan cara lain, dan itulah alasan
`--regen` berjalan di CI meski makan dua setengah menit. Keduanya punya
bentuk yang sama dan itu yang membuatnya berbahaya: **artefaknya tidak
berubah, resepnya yang rusak.** Setiap berkas di disk masih cocok dengan
hash-nya, jalur cepat lulus dengan tenang, dan kerusakannya baru muncul saat
seseorang menjalankan ulang builder berbulan-bulan kemudian — misalnya
8 karakter tiba-tiba menghadap arah yang salah, tanpa satu pun commit yang
menyentuh seni.

Hash menjaga **artefak**, yaitu yang dikirim ke pengguna. `--regen` menjaga
**resep**, yaitu klaim bahwa artefak itu bisa dibangun ulang. Dokumen ini
membuat klaim kedua, jadi gerbang kedua harus ada.
