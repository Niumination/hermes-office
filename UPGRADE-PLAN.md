# Hermes Office — Rencana Upgrade (versi faktual)

**Tanggal**: 2026-10-13
**Revisi**: Dokumen ini menggantikan versi 2026-10-12. Setiap klaim teknis di
versi lama diuji ulang terhadap kode di `d93948d`; 11 di antaranya salah fakta
dan dikoreksi di sini. Telaah lengkap dengan bukti tiap klaim ada di
`TELAAH-UPGRADE-PLAN.md`.

**Arah (keputusan pengguna, 12 Okt 2026): generik, bukan kode khusus.**
Bukan `@mitigasi` yang me-restart `agroclimate-api`, melainkan "desk eksternal"
yang didefinisikan lewat config: sumber status (HTTP/systemd/cron) + aksi yang
diizinkan. Agroclimate jadi *satu contoh konfigurasi*. Pos Jaga tahap 1
(read-only) sudah terpasang di `8bce449`.

---

## 1. Yang sudah ada — jangan dibangun ulang

| Fitur | Status | Lokasi |
|-------|--------|--------|
| Budget tracking display | **Ada** | `frontend/src/hermes/useBurnState.ts` + `frontend/src/sect/QiRing.tsx` |
| Approval gate indicators | **Ada** | `frontend/src/sect/Writ.tsx` (Titah: tertunda/kedaluwarsa) |
| Status soket (connected/luring) | **Ada** | bilah atas (`terhubung · v1.0` / `luring`) |
| Latensi soket | **Belum ada** | satu-satunya pekerjaan baru dari §2.2 versi lama |
| Desk eksternal read-only | **Ada** (tahap 1) | `server/desks.js` + `frontend/src/sect/Outposts.tsx` |
| Halaman bukti | **Ada** | `server/proof.js` + `frontend/src/sect/Seal.tsx` |
| `isGuest` filter di broadcast | **Ada** | `server/index.js:48` (`bus.frameFor(event, true)`) |
| Guest sanitization | **Ada** | redaksi angka, bukan penolakan halaman |

---

## 2. Koreksi teknis (11 butir)

### 2.1 DUAL-MODE VISUALISASI — Three.js tidak pernah ada

Versi lama: "3D pakai Three.js (sudah ada)", usul tambah Phaser untuk mode 2D.

**Faktanya:** tidak ada `three`, `@react-three/*`, maupun `phaser` di
`package.json` mana pun. R3F ditolak sadar di `docs/PRD.md` D3:

> three ~150–200 kB setelah tree-shake + ~50 kB reconciler. Yang kami kirim: +7,8 kB.

Yang ada sekarang **sudah** mode ringan: DOM + pelat pra-render. Menambah
Phaser membalik keputusan D3 — ratusan kB untuk mencapai apa yang sudah dicapai.

**Jika tampilan sprite memang diinginkan:** 132 sprite webp sudah ada di repo
(dipensiunkan dari `public/` tapi `art/` 13 MB masih sebagai sumber), plus
pipeline pelat dengan 7 aturan mutu. Jauh lebih murah dari Phaser.

**Status saat ini:** interface 宗門 (sect) sudah menggantikan kantor isometrik
sejak `ea8946f` — pelat + DOM, tanpa engine 3D. Toggle "2D mode" tidak
diperlukan karena tidak ada mode 3D.

### 2.2 LEDGER — `ledger.db` (SQLite), bukan `ledger.json`

```js
server/ledger.js:137   this.path = dbPath || join(dataDir, "ledger.db");
```

Peringatan "jangan edit ledger manual" **benar**, hanya nama berkasnya salah.

### 2.3 RUTE LEDGER — tidak ada `POST /ledger/record`

Yang ada: `GET /ledger`, `GET /ledger/head`, `GET /ledger/verify`,
`GET /ledger/anchors`, `POST /ledger/anchor` — semuanya `requireOwner`.

Tidak ada jalur tulis manual. Ledger diisi **dari jalur keputusan**
(`POST /policy/check`). Itulah desainnya.

### 2.4 `synchronous: NATIVE` — bukan mode SQLite

```js
server/ledger.js:145
this.db.pragma(`synchronous = ${/^(OFF|NORMAL|FULL|EXTRA)$/.test(synchronous) ? synchronous : "FULL"}`);
```

`NATIVE` tidak menimbulkan error — diam-diam jatuh ke `FULL`. "Optimasi" ini
tampak diterapkan padahal tidak mengubah apa pun. Yang dimaksud **`NORMAL`**.

### 2.5 `HERMES_API` — localhost, bukan host luar

```js
server/config.js:40   hermesApi: process.env.HERMES_API || "http://127.0.0.1:3000",
```

Bukan kebocoran ke pihak ketiga. Tapi masalah **nyata** di baliknya: port 3000
kosong di mesin ini → `POST /chat/completions` gagal. Kesimpulan "perlu
diarahkan ke port yang benar" tepat, alasannya saja yang keliru: risikonya
fitur mati, bukan privasi.

### 2.6 `isGuest` — sudah ada

```js
server/index.js:40   /** @type {Map<WebSocket, {isGuest: boolean, ip: string}>} */
server/index.js:48   ws.send(meta.isGuest ? bus.frameFor(event, true) : raw);
```

Broadcast sudah disaring untuk tamu.

### 2.7 `OFFICE_GUEST_TOKEN` — bukan "hanya temperature view"

Tamu punya akses ke **10 rute `requireAny`**: `/policy`, `/approvals`,
`/kiosk`, `/roster`, `/presence`, `/chat`, `/desks`, `/proof`, dan keluarga
OTLP. Yang membatasi adalah **redaksi angka**, bukan penolakan halaman.

**Bahaya keliru memahami:** `docs/SECURITY.md §3` mencatat lewat Tailscale
Funnel, "pengunjung anonim" dan "tamu" adalah **principal yang sama** — setiap
rute `requireAny` efektif terbaca publik.

### 2.8 UJI CORS — checklist lama tidak menguji apa pun

Salah:
```bash
curl -origin http://localhost:3333 http://localhost:7333/health
```
`-origin` terurai sebagai `-o rigin`. Tidak ada header `Origin` terkirim.

Benar:
```bash
curl -H 'Origin: http://localhost:3333' -i http://127.0.0.1:7333/health
```

### 2.9 Potongan kode §4.1 rusak tiga cara

```js
const manualConfig = new URL('file://' + require('path').resolve('~/.hermes/office/config.json'));
```

1. `package.json` memakai `"type": "module"` → `require is not defined`.
2. `path.resolve()` tidak memekarkan `~` → direktori literal bernama `~`.
   Yang benar `os.homedir()`.
3. Membungkus path absolut ke `new URL('file://'+…)` tidak perlu.

### 2.10 `dataDir` — defaultnya `data/` di dalam repo

```js
server/config.js:130   dataDir: process.env.OFFICE_DATA_DIR || join(__dirname, "..", "data"),
```

Nama env-nya (`OFFICE_DATA_DIR`) sudah benar di dokumen lama, hanya lokasi
default-nya yang keliru ditulis `~/.hermes/office/data`.

### 2.11 Rute: `/desks`, bukan `/api/desks`

Tidak ada awalan `/api` di mana pun. Rute baru **wajib** didaftarkan di
`HTTP_ROUTES` (`frontend/vite.config.ts`), kalau tidak ia 404 hanya di
`npm run dev` — persis kelas bug `/kiosk` yang dulu lolos 16 gerbang.

---

## 3. Yang benar dari versi lama (tetap dikerjakan)

- ✅ `POST /policy/check` adalah enforcement, bukan observability.
- ✅ Default `ALLOWED_ORIGINS` mencakup 3333/5173/7333 (`server/config.js:63`).
  Sejarahnya benar seperti dikhawatirkan: dulu 5173 saja → WS 403 tiap
  `npm run dev`, terlihat seperti "socket flaky".
- ✅ Anchor ledger berkala — `POST /ledger/anchor` sudah ada.
- ✅ Peringatan "jangan edit ledger manual" — benar.
- ✅ `check-handoff.sh --write` setelah tiap commit — aturan rumah.
- ✅ Fleet listing cron job sebagai "desk" — ide yang cocok dengan prinsip
  "agen punya ruangan, bukan koordinat". Sudah terwujud sebagai **desk
  eksternal** (`server/desks.js`).
- ✅ Rollback plan.

---

## 4. Pekerjaan tersisa (diurutkan)

### 4.1 Latensi soket (kecil, satu-satunya fitur baru dari §2.2 lama)

Bilah atas sudah menampilkan status; tambahkan angka latensi (ms) di
sampingnya. Sumber: `performance` di `useOfficeSocket.ts`.

### 4.2 Pos Jaga tahap 2 — aksi berpagar

Desain lengkap di `DESAIN-posjaga-tahap2.md` (status: usulan, menunggu
persetujuan). Prinsipnya:

> **Office tidak boleh pernah menjalankan perintah yang Anda ketik di UI.**
> Yang boleh: memanggil aksi **yang sudah dideklarasikan di config**, dengan nama.

- `run` = array argv (tidak ada shell → tidak ada `;`, `&&`, backtick).
- Nol interpolasi `${...}`.
- `requireOwner` + `POST /policy/check` + dicatat di ledger.
- Jeda antar-aksi (default 60 detik per aksi per pos).
- Tidak ada eksekusi otomatis (itu tahap 3).
- `confirm: true` default; timeout wajib maks 60 detik.

Rute: `POST /desks/:id/actions/:actionId` → `requireOwner`.
Respons: `{ok, exitCode, ms, ledgerSeq}` — tanpa stdout/stderr mentah.

**Alternatif 80% manfaat tanpa biaya eksekusi:** aksi "tandai sudah dilihat"
(snooze) — tidak menyentuh server luar sama sekali.

### 4.3 Sisa 11 kekeliruan di TELAAH — sudah dikoreksi di dokumen ini

Selesai. Lihat §2 di atas.

### 4.4 Halaman bukti/keandalan untuk penjualan

`/proof` sudah ada (`server/proof.js`). Tiga klaim dilaporkan terpisah:
**LANGSUNG** (rantai ledger), **TERCATAT** (18/18 gerbang), **PENGIKATAN**
(`bundleMatches` — sha256 bundel yang disajikan vs yang diuji).

Sisa: masukkan ke README/PRICING sebagai "verifikasi sendiri" — pembeli
menjalankan satu perintah dan mendapat 18/18.

---

## 5. Arah produk (keputusan 12 Okt 2026)

Hermes Office adalah **alat tata kelola armada agen**. (Empat tingkat harga
yang dulu tertulis di sini dicabut 20 Okt 2026 — satu pemilik, satu token,
tidak ada yang dijual.) Kebutuhan monitoring agroclimate Niu Gayo hidup
sebagai **satu contoh konfigurasi** desk eksternal, bukan kode khusus
`@mitigasi`.

Setiap aksi yang menjalankan shell mengubah office dari *pengamat berwenang*
menjadi *eksekutor* pada layanan yang terpapar publik lewat Funnel — pagar di
§4.2 membuatnya bisa dipertahankan, tapi tidak membuatnya gratis.

---

## 6. Aturan yang berlaku saat eksekusi

- `server/index.js` upstream, `server/chat.js`, `chat-db.js`: jangan diubah
  langsung. Router baru terpisah seperti `desks.js`/`proof.js`.
- Rute baru wajib didaftarkan di `HTTP_ROUTES` (`frontend/vite.config.ts`).
- Gerbang 15 (klaim dokumen) memeriksa 101 klaim terhadap repo — setiap angka
  yang berubah akan tertangkap. Itu fitur.
- `check-handoff.sh --write` setelah commit berkas ter-track.
- Jangan turunkan ambang gerbang agar hijau.
