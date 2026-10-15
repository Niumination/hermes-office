# Tugas untuk Hermes — ekosistem LightVela

Ditulis 15 Okt 2026 oleh agen Arena, basis `5bca66d` + dua commit perbaikan.

Ini daftar hal yang **tidak bisa dikerjakan dari sandbox Arena** karena butuh
akses ke mesin Anda, kredensial produksi, atau keputusan operasional. Kode
untuk semuanya sudah siap dan hijau; yang kurang hanya tangan di mesin yang
tepat.

Urut berdasarkan dampak. Nomor 1 memblokir sisanya.

---

## 1. Restart backend live — **memblokir semuanya** 🔴

**Kenapa:** perbaikan penempatan agen ada di `server/index.js`. Aset statis
baru tidak memuat ulang proses Node. Tanpa restart, lantai tetap kosong
betapapun benarnya kode.

Pelajaran ini sudah dibayar sekali: backend live pernah berjalan tanpa restart
sejak 12 Okt 14:55 UTC sementara tiga paket perbaikan menumpuk di Drive, dan
semua gerbang hijau selama itu — karena tidak satu pun gerbang menyentuh situs
live.

```bash
cd /path/ke/hermes-office
git pull
npm ci
(cd frontend && npm ci && npm run build)
sudo systemctl restart hermes-office
```

**Verifikasi — jangan lewati:**

```bash
# uptime harus kecil lagi
curl -s https://dash.abstract.biz.id/health

# ambil cookie tamu, lalu lihat lantainya
curl -s -c /tmp/j https://dash.abstract.biz.id/ -o /dev/null
curl -s -b /tmp/j https://dash.abstract.biz.id/policy | grep -o '"agent":"[^"]*"'
```

Harus keluar nama agen. Kalau masih kosong, event belum masuk sejak restart —
tunggu satu menit dan ulangi.

---

## 2. Pasang `mac-relay` — Mac tidak pernah melapor 🔴

**Bukti:** `mac` terdaftar di `/roster` tapi **tidak ada sama sekali** di
`/presence`. Bukan "offline" — ia belum pernah mengirim satu event pun sejak
instance ini berdiri. Tugasnya masih tergeletak belum dikerjakan di `/chat`:

> *"@mac TUGAS MAC: pasang mac-relay Hermes Office. Langkah: (1) Clone atau
> pull repo https://github.com/Niumination/herm…"*

Selama ini belum dikerjakan, Mac **tidak akan muncul di kantor** betapapun
benarnya perbaikan nomor 1. Penempatan otomatis hanya bisa menempatkan agen
yang mengirim event.

Berkasnya sudah ada di repo: `bridges/mac-relay/mac-relay.sh` (98 baris) dan
`bridges/mac-relay/octo-watcher.py` (187 baris).

**Yang perlu diputuskan Anda:** token mana yang dipakai Mac. `OFFICE_MAC_TOKEN`
di instance live tidak diketahui agen Arena — token di `/home/user/.env.office`
menghasilkan 401 terhadap live, jadi kredensial produksi sudah berganti sejak
cadangan itu dibuat.

---

## 3. Isi config desks — Pos Jaga kosong 🟡

`/desks` mengembalikan `{"desks":[]}`. Fitur Pos Jaga lengkap, teruji, dan
sudah ter-deploy — termasuk tombol aksi, cooldown, dan dialog konfirmasi yang
diperbaiki di Fase 14 — tapi tidak punya satu pun pos untuk dipantau.

Kontraknya ada di `server/desks.js`. Tiap pos butuh `id`, `label`, dan sebuah
probe (`http` atau `file`). Pagu: maksimum 64 pos, 16 aksi per pos.

Kandidat yang masuk akal untuk topologi LightVela Anda:

| pos | probe | alasan |
|---|---|---|
| kontainer Hermes per profil | `http` ke health masing-masing | inti armada |
| Cloudflare Tunnel | `http` | kalau mati, seluruh dasbor hilang |
| disk VPS | `file` | 5–7 kontainer × ±400 MB di VPS 4 GB |

**Keputusan Anda:** pos mana yang benar-benar ingin dipantau. Mengisinya dengan
pos contoh lebih buruk daripada kosong — Pos Jaga yang menampilkan status palsu
persis jenis ketidakjujuran yang dilarang produk ini.

---

## 4. Token owner untuk mencoba pintu masuk baru 🟡

Commit kedua menambahkan `Warrant` — layar masuk pemilik yang sebelumnya tidak
pernah ada. Sampai Anda memasukkan `OFFICE_OWNER_TOKEN` lewat pintu itu di
peramban, **tidak ada seorang pun yang pernah melihat permukaan owner**: ledger,
dossier, replay, dan tombol aksi Pos Jaga semuanya `requireOwner`.

Setelah restart, buka `https://dash.abstract.biz.id/`, klik **"Tamu · masuk"**
di header, tempel token. Token dikirim sekali dan tidak disimpan; server
membalas dengan cookie `HttpOnly`.

Kalau ditolak, pesan yang muncul adalah **kata-kata server**, bukan karangan
UI — `401` berarti token salah, `429` berarti tabel sesi penuh. Dua masalah
berbeda dengan dua perbaikan berbeda.

---

## 5. Gerbang yang menyentuh situs live — **usulan, bukan tugas** 🟢

Seluruh 17 gerbang berjalan di atas checkout. **Nol** melakukan permintaan HTTP
ke `dash.abstract.biz.id`. Itu sebabnya pemadaman tiga hari kemarin tidak
terlihat oleh siapa pun: gerbang hijau membuktikan repo sehat, bukan situs
sehat.

Satu gerbang kecil, sekitar 30 baris, akan menutup seluruh kelas cacat itu:

- ambil `/health`, bandingkan `uptimeS` dengan umur commit terakhir yang
  ter-deploy — kalau uptime jauh lebih tua, backend belum di-restart
- pastikan `/desks` dan `/proof` menjawab `application/json`, bukan HTML

Rute API yang hilang muncul sebagai **HTML 200**, bukan 404, karena fallback
SPA menelannya. Itu yang membuat kerusakan kemarin tidak kentara.

Saran: tambahkan ini **sebelum** menambah fitur baru apa pun.

---

## Yang sudah dikerjakan dari sisi Arena

| | |
|---|---|
| `1472ed5` | agen bekerja kini berdiri di denah; aula dibaca dari lantai server |
| *(commit kedua)* | `Warrant` — pintu masuk pemilik |

Gerbang 17/17 hijau. Backend 377→**383** tes, frontend 135→**148**.
Sembilan uji mutasi, semuanya merah lalu dipulihkan.

Diuji ujung-ke-ujung di server sungguhan, bukan hanya unit: event bridge masuk →
`/policy` menampilkan `cloud` dan `peneliti` di lobby dengan `grantedBy=auto`;
tamu melihat penghuni yang sama tanpa anggaran; `POST /auth/session` menukar
token jadi cookie yang membuka `/ledger`, `/dossier`, dan `/desks`.

---

## Butir terbuka yang perlu keputusan Anda

**`roomForEvent()` masih menebak ruangan di klien** dan kini bersaing dengan
kebenaran server. Heuristiknya menaruh `cloud` di `server-room` dan `mac` di
`mac-studio` — keduanya ruangan ber-`entryApproval: true`, artinya UI menggambar
agen di tempat yang menurut kebijakan perlu tanda tangan untuk dimasuki.

Belum dihapus karena menghapusnya mengubah perilaku untuk agen yang belum
ter-assign. Tiga pilihan:

1. **Hapus** — server jadi satu-satunya sumber lokasi. Paling bersih, paling
   jujur, tapi agen tanpa assignment jadi tidak tergambar sama sekali.
2. **Pertahankan sebagai cadangan** — dipakai hanya bila server tidak punya
   penempatan. Perlu aturan jelas siapa menang.
3. **Pindahkan ke policy** — jadikan `cloud`→`server-room` keputusan kebijakan
   yang ditulis di file policy, bukan tebakan di kode frontend. Paling sesuai
   dengan prinsip "denah lantai ADALAH kebijakan", tapi paling banyak kerja.

Rekomendasi saya: **nomor 3**, setelah nomor 1–4 di atas selesai.
