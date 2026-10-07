# Mode Kiosk — layar dinding (Fase 13)

`GET /kiosk` — halaman status layar penuh untuk TV di sudut kantor.

Ini satu-satunya fitur yang menjual produk **saat tidak ada yang memakainya**.
Kerangka berpikir itu menentukan setiap keputusan di bawah.

## Ia menurunkan haknya sendiri

Aturan terpenting di sini: **kiosk merender tampilan TAMU secara default,
bahkan ketika permintaan membawa cookie owner yang sah.**

Ini terlihat salah sampai Anda membayangkan deployment sebenarnya. Layar itu
ada di dinding. Ia dilihat tamu, petugas kebersihan, kurir, siapa pun yang
lewat saat demo, dan setiap kamera ponsel di ruangan. Orang yang memasangnya
akan melakukannya dari laptopnya sendiri, dalam keadaan login sebagai owner,
dan **tidak akan pernah memikirkan cookie itu lagi**. Default ke tampilan
owner berarti menaruh angka dolar langsung di dinding publik, selamanya,
tanpa sengaja.

Owner yang memang ingin angka di layar memakai `?reveal=1` **dan** tetap
harus memegang sesi owner. Opt-in, per-URL, terlihat di address bar mesin
yang menjalankannya.

| Permintaan | Dolar |
|---|---|
| anonim / tamu | tidak |
| tamu + `?reveal=1` | **tidak** |
| owner | **tidak** |
| owner + `?reveal=1` | ya, hanya per jam |

Belanja harian dan seumur hidup **tidak pernah** muncul, bahkan dengan
`reveal`. Per jam adalah angka operasional; sisanya metrik bisnis yang tidak
pernah diminta siapa pun untuk dipublikasikan.

Rasio **memang** lolos tanpa reveal — ia suhu, bukan jumlah. Itu sudah bagian
dari kontrak tamu sejak Fase 2.

## Tanpa build, tanpa jaringan

HTML mandiri: CSS inline, tanpa font, tanpa CDN, tanpa bundle. Kiosk yang
rusak ketika pipeline aset berubah adalah kiosk yang akan menampilkan halaman
rusak saat rapat direksi. Ada test yang menolak `<link>`, `src=http`,
`@import`, dan web font.

Halaman dirender di server, jadi **cat pertama sudah benar tanpa JavaScript**.
Loop penyegaran adalah peningkatan progresif, dengan `<noscript><meta
http-equiv="refresh">` sebagai lantai.

## Basi ditampilkan, bukan disembunyikan

Kalau penyegaran gagal, halaman mempertahankan frame terakhir yang baik **dan
mengatakan umurnya**. Lewat 45 detik ia berganti jadi `TERPUTUS — data Ns
lalu` berwarna merah.

Layar dinding yang membeku pada data basi tapi terlihat hidup lebih buruk
daripada tidak ada layar: ia akan dipercaya justru karena tidak ada yang
berinteraksi dengannya. Kegagalan beruntun juga memperlambat polling sampai
5 menit — server mati tidak boleh dihajar layar yang tak ditonton.

## Auto-guest diperluas, sengaja dan sempit

`GET /kiosk` kini mencetak sesi tamu seperti `GET /`. TV membuka satu URL saat
boot dan tidak punya cara login; tanpa ini ia menampilkan 401 selamanya.

Permukaan yang ditambah adalah halaman yang **sudah** teredaksi-tamu secara
konstruksi dan tidak menampilkan dolar bahkan untuk owner, jadi ia tidak
memberi penonton publik apa pun yang tidak bisa mereka baca dari `/`. Lihat
SECURITY.md §3 untuk model ancaman auto-guest selengkapnya.

Satu jebakan yang ditemukan saat pengujian: cookie yang dicetak hanya terkirim
pada permintaan **berikutnya**, jadi permintaan yang mencetaknya tetap gagal
autentikasinya sendiri. `GET /` tidak pernah menyadarinya karena ia menyajikan
berkas statis tanpa auth. Middleware kini menempelkan cookie ke request itu
juga.

## Keamanan render

Nama agent, label ruangan, dan nama alat datang dari telemetri — string
sembarang yang bisa dipengaruhi penyerang. Halaman ini **satu-satunya** tempat
di produk yang merender string itu sebagai markup mentah.

Setiap interpolasi melewati `esc()`. Ada test yang memasukkan `<script>` dan
`" onload=` sebagai nama agent.

## Menjalankannya

```
https://office.example.com/kiosk            ← untuk dinding
https://office.example.com/kiosk?reveal=1   ← owner, angka terlihat
```

Chromium kiosk di Raspberry Pi:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --check-for-update-interval=31536000 \
  https://office.example.com/kiosk
```

Penyegaran 15 detik. `Cache-Control: no-store` — layar dinding tidak boleh
pernah disajikan dari cache proxy basi.
