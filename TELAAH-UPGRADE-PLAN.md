# Telaah `UPGRADE-PLAN.md`

**12 Oktober 2026** · dokumen ditelaah: `UPGRADE-PLAN.md` @ `f3114b8` (177 baris)
Semua klaim di bawah diuji terhadap kode di `881629f`, bukan dari ingatan.

---

## 0. Lebih dulu: koreksi status repo

Anda menyampaikan perubahan terakhir **sudah diterapkan ke repo**. Saya periksa,
dan **belum**:

| Yang dicek | Hasil |
|---|---|
| `main` | `f3114b8` — satu commit baru, isinya **hanya** `UPGRADE-PLAN.md` (+178/−0, 1 berkas) |
| `dev` | masih `881629f` — tidak bergerak |
| commit `fb085e1` (perbaikan `/kiosk`) | **tidak ada** di upstream (API: 422) |
| commit `0c077cf` (Sabda) | **tidak ada** di upstream (API: 422) |
| `frontend/src/sect/Sabda.tsx` di `main` | **404** |
| kata `kiosk` di `frontend/vite.config.ts` @ `main` | **0 kemunculan** |

Jadi yang masuk ke repo adalah dokumen rencana ini, bukan dua commit saya.
Keduanya masih hanya ada di bundel lokal. Kabar baiknya: branch saya **2 commit
di depan `dev`, 0 di belakang** — masih maju-cepat bersih, tidak ada konflik.
Perintah dorong tetap seperti di `SINKRONISASI.md`.

Catatan tambahan: `main` dan `dev` kini **bercabang** (main punya dokumen ini,
dev tidak).

---

## 1. Penilaian singkat

Dokumen ini punya **tujuan yang masuk akal** — memantau cron job agroclimate
(mitigasi, alerts, imerg) langsung dari office. Tapi sebagai rencana kerja ia
**belum bisa dieksekusi apa adanya**: sebagian besar premis teknisnya tidak
cocok dengan kode yang ada, dan satu fitur utamanya dibangun di atas sesuatu
yang tidak pernah ada di repo ini.

Saya pisahkan jadi tiga: yang **salah fakta**, yang **sudah ada** (jadi akan
dibangun ulang sia-sia), dan yang **benar dan layak dikerjakan**.

---

## 2. Yang salah fakta — dengan buktinya

### 2.1 ⛔ "3D pakai Three.js (sudah ada)" — Three.js tidak pernah ada di repo ini

Ini yang paling berat, karena **fitur utama #1 (dual-mode 3D+2D) berdiri di
atasnya**. Tidak ada `three`, `@react-three/*`, maupun `phaser` di
`package.json` mana pun. R3F **ditolak secara sadar** dan alasannya tercatat:

> `docs/PRD.md:353` — **D3**: "Pelat pra-render + satu shader" vs "React Three
> Fiber": *three ~150–200 kB setelah tree-shake + ~50 kB reconciler. Yang kami
> kirim: **+7,8 kB**.*

Jadi "toggle 2D" bukan menambah mode ringan di samping mode berat — yang ada
sekarang **sudah** mode ringan (DOM + pelat pra-render). Usulan menambah
**Phaser** justru membalik keputusan D3: ia menambah ratusan kB untuk mencapai
hal yang sudah dicapai tanpa itu.

> Kalau yang diinginkan adalah tampilan pixel/sprite, bahannya sudah ada:
> **132 sprite webp menganggur** di repo, plus pipeline pelat dengan 7 aturan
> mutu. Itu jalur yang jauh lebih murah daripada Phaser.

### 2.2 ⛔ "`data/ledger.json`" — ledger itu SQLite, bukan JSON

Disebut dua kali, termasuk di §7 sebagai peringatan keras ("jangan pernah
mengubah `data/ledger.json` secara manual"). Yang ada:

```
server/ledger.js:137   this.path = dbPath || join(dataDir, "ledger.db");
```

Peringatannya sendiri **benar dan penting** — hanya nama berkasnya salah.
Berbahaya karena orang bisa mencari berkas yang tidak ada lalu menyimpulkan
ledger belum aktif.

### 2.3 ⛔ `POST /ledger/record` tidak ada

Disarankan sebagai cara aman menulis ledger. Rute `/ledger` yang benar-benar
ada: `GET /ledger`, `GET /ledger/head`, `GET /ledger/verify`,
`GET /ledger/anchors`, `POST /ledger/anchor` — semuanya `requireOwner`.
Tidak ada jalur tulis manual; ledger diisi **dari jalur keputusan**
(`POST /policy/check`, `POST /budget/check`), dan itu memang desainnya.

### 2.4 ⛔ `synchronous: NATIVE` bukan mode SQLite

Mode yang sah hanya `OFF | NORMAL | FULL | EXTRA`, dan kode memang memvalidasinya:

```
server/ledger.js:145
this.db.pragma(`synchronous = ${/^(OFF|NORMAL|FULL|EXTRA)$/.test(synchronous) ? synchronous : "FULL"}`);
```

Artinya menyetel `NATIVE` **tidak menimbulkan error** — ia diam-diam jatuh
kembali ke `FULL`. Jadi "optimasi" ini akan tampak diterapkan padahal tidak
mengubah apa pun. Yang Anda maksud hampir pasti **`NORMAL`**.

### 2.5 ⛔ "`HERMES_API` menunjuk ke host orang tua yang tidak dikontrol"

Nilainya `http://127.0.0.1:3000` (`server/config.js:40`) — itu **localhost**,
bukan host luar. Tidak ada kebocoran ke pihak ketiga.

Tapi ada masalah **nyata** di baliknya, dan saya melihatnya langsung saat
menjalankan server giliran lalu:

```
[chat] hermes proxy failed: fetch failed   (×8)
```

Yaitu: port 3000 **kosong** di mesin ini, jadi `POST /chat/completions` gagal.
Jadi kesimpulan "perlu diarahkan ke port yang benar" **tepat**, alasannya saja
yang keliru. Risikonya bukan privasi, melainkan fitur mati.

### 2.6 ⛔ "Tambah `isGuest` flag" — sudah ada sejak lama

§3.1 mengusulkan menambahkan penyaringan guest pada broadcast. Kode sekarang:

```js
const wsClients = new Map();   // {isGuest: boolean, ip: string}
function broadcast(event) {
  const raw = JSON.stringify({ channel: "event", data: event });
  for (const [ws, meta] of wsClients) {
    ...
    ws.send(meta.isGuest ? bus.frameFor(event, true) : raw);   // ← sudah disaring
  }
}
```

### 2.7 ⛔ "`OFFICE_GUEST_TOKEN` → hanya temperature view"

Tamu punya akses ke **10 rute `requireAny`**, antara lain `/burn`, `/policy`,
`/approvals`, `/kiosk`, dan seluruh keluarga `/chat`. Yang membatasi mereka
bukan daftar rute, melainkan **redaksi**: angka dicoret, bukan halaman ditolak.
Keliru memahami ini berbahaya — `docs/SECURITY.md §3` mencatat bahwa lewat
Tailscale Funnel, "pengunjung anonim" dan "tamu" adalah **principal yang sama**,
sehingga setiap rute `requireAny` efektif **terbaca publik**.

### 2.8 ⛔ Uji CORS di checklist **tidak menguji apa pun**

```
curl -origin http://localhost:3333 http://localhost:7333/health
```

`-origin` bukan flag curl; ia terurai sebagai `-o rigin`. Saya jalankan dan
rekam header yang benar-benar terkirim:

```
> GET / HTTP/1.1
> Host: 127.0.0.1:8099
> User-Agent: curl/8.14.1
> Accept: */*
```

**Tidak ada header `Origin` sama sekali.** Jadi butir checklist ini akan selalu
"lulus", termasuk ketika CORS benar-benar rusak. Yang benar:

```bash
curl -H 'Origin: http://localhost:3333' -i http://127.0.0.1:7333/health
```

### 2.9 ⛔ Potongan kode §4.1 rusak tiga cara sekaligus

```js
const manualConfig = new URL('file://' + require('path').resolve('~/.hermes/office/config.json'));
```

1. `package.json` memakai `"type": "module"` → `require is not defined in ES
   module scope` (diuji, error persis itu).
2. `path.resolve()` **tidak** memekarkan `~`. Hasil sebenarnya:
   `/home/user/repo/~/.hermes/office/config.json` — sebuah direktori literal
   bernama `~`. Yang benar `os.homedir()`.
3. Membungkus path absolut ke `new URL('file://'+…)` tidak diperlukan.

### 2.10 ⚠️ `dataDir` bukan `~/.hermes/office/data`

```
server/config.js:130   dataDir: process.env.OFFICE_DATA_DIR || join(__dirname, "..", "data")
```

Defaultnya `data/` **di dalam repo**. Nama env-nya (`OFFICE_DATA_DIR`) sudah
benar di dokumen.

### 2.11 ⚠️ Inkonsistensi rute: `/desks` vs `/api/desks`

§4.2 mendefinisikan `GET /desks`; §4.3 menyuruh frontend memanggil
`/api/desks`. Repo ini tidak punya awalan `/api` di mana pun. Perlu dipilih
satu — dan kalau lewat dev server, rute barunya **wajib** didaftarkan di
`HTTP_ROUTES` pada `frontend/vite.config.ts`, kalau tidak ia 404 di `npm run
dev` (ini persis kelas bug `/kiosk` yang baru saya perbaiki).

---

## 3. Yang sudah ada — akan terbangun ulang kalau diikuti apa adanya

Ketiga "fitur tambahan" di §2.2 sudah terpasang dan terlihat di tangkapan layar
giliran lalu:

| Usul | Status sebenarnya |
|---|---|
| **6. Budget tracking display** | **Ada** — `useBurnState` + `QiRing`; bilah atas menampilkan *Atur Napas · $0.00 · tanpa pagu*, dan rail Tataran menampilkan pagu per-aula ($10/$5/$3/$2/$1/$0,25) |
| **7. Approval gate indicators** | **Ada** — `Writ.tsx` (Titah), lengkap dengan status tertunda/kedaluwarsa dan perilaku tamu |
| **8. Gateway health widget** | **Sebagian** — status soket sudah di bilah atas (`terhubung · v1.0` / `menyambung…` / `luring`). Yang **belum** ada hanya **latensi**. |

Jadi dari tiga butir itu, yang benar-benar pekerjaan baru hanyalah angka
latensi.

---

## 4. Yang benar dan layak dikerjakan

Ini bukan dokumen yang buruk — beberapa bagiannya tajam:

- ✅ **`POST /budget/check` adalah jalur enforcement, bukan observability**
  (§7). Benar, dan penting.
- ✅ **Default `ALLOWED_ORIGINS` memang sudah mencakup 3333/5173/7333** —
  diverifikasi di `server/config.js:63`. Sejarahnya bahkan persis seperti yang
  dikhawatirkan dokumen ini: dulu defaultnya 5173 saja, sehingga WS ditolak 403
  tiap `npm run dev` dan terlihat seperti "socket flaky" — komentar di kode
  menyebutnya kata demi kata.
- ✅ **Anchor ledger berkala** — sejalan dengan desain; `POST /ledger/anchor`
  sudah ada.
- ✅ **Peringatan "jangan edit ledger manual"** — benar (hanya nama berkasnya
  salah).
- ✅ **`check-handoff.sh --write` setelah tiap commit** — memang aturan rumah.
- ✅ **Fleet listing cron job sebagai "desk"** — ini ide barunya, dan
  **cocok** dengan prinsip produk "agen punya ruangan, bukan koordinat".
  Sebuah cron job yang punya meja, status, dan riwayat adalah perluasan yang
  natural, bukan tempelan.
- ✅ **Rollback plan** — ada, dan itu bagus.

---

## 5. Persoalan yang lebih besar: ini dua produk berbeda

Yang perlu Anda putuskan sadar-sadar, bukan saya putuskan diam-diam.

Hermes Office yang kita kerjakan sembilan fase terakhir adalah **produk tata
kelola armada agen yang bisa dijual** — PRD-nya $0 / $39 Solo Pro / $299 Team /
$2.000+ Enterprise, dengan tiga prinsip: *replay = tata kelola*, *policy as
floor plan*, dan *UI tidak boleh mengarang penolakan, menyembunyikan angka yang
diketahui, maupun mengarang lokasi*.

`UPGRADE-PLAN.md` menggambarkan sesuatu yang lain: **dasbor monitoring internal
untuk Niu Gayo Agroclimate** — `@mitigasi` me-restart `agroclimate-api`,
`@imerg` mengecek GES DISC, desk = cron job, catatan di `~/.hermes/brain/`.

Keduanya sah. Tapi menggabungkannya tanpa keputusan akan menghasilkan produk
yang tidak bisa dijual **dan** tidak enak dipakai sendiri: pembeli luar tidak
punya `agroclimate-api`, dan setiap `@mention` yang menjalankan `systemctl`
mengubah office dari *pengamat berwenang* menjadi *eksekutor perintah shell* —
perubahan model ancaman yang besar, pada layanan yang **sudah terpapar publik
lewat Tailscale Funnel**, di mana tamu = pengunjung anonim.

Tiga arah yang masuk akal:

1. **Fork pemakaian sendiri.** Produk tetap bersih; kebutuhan agroclimate
   hidup di fork/overlay. Paling aman, paling sedikit kompromi.
2. **Jadikan generik.** Bukan `@mitigasi`, melainkan "desk eksternal" yang
   didefinisikan lewat config: sumber status (HTTP/systemd/cron) + aksi yang
   diizinkan. Agroclimate jadi *satu contoh konfigurasi*, bukan kode khusus.
   Ini yang akan **menaikkan** harga jual, bukan menurunkannya.
3. **Tunda.** Dorong dulu dua commit yang sudah hijau, baru buka babak baru.

Saya condong ke **(2) dengan (3) lebih dulu**.

---

## 6. Hal yang wajib diingat kalau rencana ini dieksekusi

- **`server/index.js` upstream, `server/chat.js`, `chat-db.js` = jangan
  diubah** (aturan yang berlaku selama ini: UI menyesuaikan server). §4.2
  meminta menambah rute langsung di `server/index.js` — perlu dibicarakan dulu,
  atau dipasang sebagai router terpisah seperti `chat.js`.
- **Rute baru harus didaftarkan di `HTTP_ROUTES`** (`frontend/vite.config.ts`),
  kalau tidak ia 404 hanya di dev dan lolos semua gerbang.
- **Gerbang 15 (klaim dokumen) akan menangkap** setiap angka yang berubah —
  111 klaim diperiksa terhadap repo. Itu fitur, bukan gangguan.
- **Tidak ada gerbang yang menjalankan dev server atau memeriksa tata letak
  terrender.** Dua regresi nyata (`/kiosk`, dan chat yang mati total di WS)
  lolos 16/16. Kalau ada satu hal dari daftar "masih terbuka" yang pantas
  dikerjakan lebih dulu, itu dia.
- **`@mention` yang menjalankan `systemctl` butuh jalur izin sendiri** —
  minimal `requireOwner` + lewat `POST /policy/check`, supaya tercatat di
  ledger seperti keputusan lain. Jangan jadikan ia jalan pintas yang tak
  terekam.

---

## 7. Saran langkah berikutnya

1. **Dorong `fb085e1` + `0c077cf` ke `dev`** (maju-cepat, 16/16 hijau).
   Bundel: `/home/user/hermes-office-sabda.bundle`.
2. **Putuskan arah §5** — ini keputusan Anda, bukan keputusan teknis.
3. Kalau jadi lanjut: saya rapikan `UPGRADE-PLAN.md` jadi versi yang
   **faktual** (perbaiki 11 butir di §2) dan **bisa dieksekusi**, lalu
   pecah jadi tahapan dengan kriteria terima seperti `RENCANA-v3.md`.
4. Usul saya untuk tahap pertama, kalau arah (2) dipilih: **desk eksternal
   read-only** — status saja, belum ada aksi. Nilainya langsung terasa,
   model ancamannya tidak berubah sama sekali, dan ia bisa dikirim dalam satu
   patch kecil.
