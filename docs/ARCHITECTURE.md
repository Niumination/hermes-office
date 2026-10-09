# Architecture — Hermes Office v2

> Dokumen ini menggambarkan repo **apa adanya**, bukan rencananya. Setiap
> angka di sini diambil dari pohon sumber yang sama dengan yang Anda clone.
> Kalau ada yang tidak cocok, dokumennya yang salah — laporkan.
>
> Terakhir diselaraskan: Fase 7. Verifikasi: `bash scripts/check-ci.sh`,
> `npm test`, `cd frontend && npm test`.

---

## 1. Apa produk ini sebenarnya

Hermes Office memvisualisasikan armada agen AI sebagai **kantor isometrik
bergaya donghua 3D** — tetapi inti komersialnya bukan visualisasi itu.

Reposisi yang menentukan arsitektur: *bukan "dasbor yang menampilkan agen",
melainkan **ruang kendali spasial di mana denah lantai ADALAH kebijakan***.
Ruangan bukan dekorasi. Ruangan adalah unit kebijakan: setiap ruangan membawa
tingkat kepercayaan, daftar alat yang diizinkan/ditolak, plafon tier model,
anggaran per jam, dan aturan persetujuan. Memindahkan agen antar ruangan
**mengubah apa yang boleh ia lakukan**.

Tiga pilar yang sudah berdiri:

| Pilar | Modul inti | Yang dijual |
|---|---|---|
| **A. Ingest OTLP** | `otlp.js`, `pricing.js` | Menerima jejak OpenTelemetry GenAI apa adanya; menormalkan ejaan atribut yang berbeda-beda antar framework |
| **B. Tata kelola spasial** | `policy.js`, `burnrate.js` | Penegakan **di jalur permintaan**, bukan laporan setelah kejadian. Mengarahkan sebelum menghentikan |
| **C. Perekam penerbangan** | `ledger.js`, `anchor.js`, `dossier.js` | Rantai hash anti-rusak + ekspor dosier EU AI Act |

---

## 2. Peta modul

### Server (`server/`, ~4.300 baris)

```
index.js      1263   entry: HTTP + WS + static, semua rute, shutdown bersih
policy.js     585   Fase 3 — denah lantai sebagai kebijakan, persetujuan
burnrate.js   442   Fase 2 — akuntansi biaya, tangga keadaan, keputusan
eventbus.js   412   validasi, clamp, REDAKSI, rate limit, ring buffer
otlp.js       403   Fase 1 — OTel GenAI → event Hermes
ledger.js     379   Fase 4 — rantai hash append-only
standup.js    465   Fase 14 — bacaan pagi; deterministik, tanpa panggilan model
kiosk.js      269   Fase 13 — layar dinding, teredaksi-tamu saat dibangun
replay.js     280   Fase 12 — Time Machine: rekonstruksi deterministik
anchor.js     296   Fase 11 — penambatan eksternal (anti-pemotongan ekor)
dossier.js    346   Fase 4 — rantai → dokumen untuk petugas kepatuhan
chat.js       240   rute /chat/*, proxy gateway Hermes (SSE → WS)
config.js     137   seluruh konfigurasi env, validasi wajib saat boot
github.js     116   poller repo (mati kecuali token DAN org terisi)
chat-db.js    101   SQLite (WAL) untuk riwayat chat
pricing.js    100   token → USD, pencocokan prefiks-terpanjang
auth.js        91   Bearer per-sumber, SHA-256
```

### Frontend (`frontend/src/`, ~4.400 baris)

```
rooms.ts            540   definisi 12 ruangan: furnitur, waypoint, titik berdiri
hermes/OfficeStage  535   panggung tunggal; pintu mengganti ruangan aktif
agentManager.ts     395   pathfinding, penempatan, siklus hidup agen
components/AtmosphereLayer 322   Fase 5 — shader WebGL (god ray, debu, grade)
hermes/ChatPanel    185   
components/Character 190   sprite 4-arah + gelembung
hermes/AgentsPanel  165   seed dari /presence, poll 30 dtk (WS tanpa replay)
components/BurnOverlay 178 HUD anggaran — kini prop-driven, tanpa fetch
components/ApprovalGate 171 gerbang persetujuan, sadar-redaksi
hermes/useOfficeSocket 171 klien WS, reconnect
hermes/useBurnState 117   Fase 6 — seed sekali + push WS, NOL polling
components/AuditBadge 120 Fase 4 — status rantai, ekspor dosier
```

---

## 3. Aliran data

```
  SUMBER                      INGEST                PENEGAKAN           KELUARAN
  ──────                      ──────                ─────────           ────────
  Hermes Cloud hook ─┐
  Mac relay ─────────┼─ POST /event ──┐
  GitHub poller ─────┘                │
                                      ├─→ eventbus.validate
  Claude Code / Copilot ─ POST /v1/traces          │
  / Codex (OTel GenAI)   └→ otlp.map ──┘           │
                                                   ▼
                                            clamp 500/4000 char
                                            source dipaksa dari identitas
                                                   ▼
                                            ┌──  REDAKSI  ──┐
                                            │ sanitizeForGuest│
                                            └───────┬────────┘
                                                    ▼
                                      ring buffer (100k / 7 hari)
                                                    │
   POST /policy/check ──→ policy.decide() ──────────┤
        │                      │                    │
        │                      └→ burnrate.decide() │
        │                                           │
        └──────────→ ledger.append() ───────────────┤
                     (rantai SHA-256)               │
                                                    ▼
                                            WS broadcast → frontend
                                                    │
                                     ┌──────────────┼──────────────┐
                                     ▼              ▼              ▼
                              OfficeStage    useBurnState    AgentsPanel
                                     │              │
                                     └→ AtmosphereLayer (shader membaca state)
```

**Titik yang sering disalahpahami:** redaksi terjadi **sekali**, di
`eventbus.js`, sebelum apa pun menyentuh ring buffer atau socket. Tetapi itu
hanya menutup jalur socket. Jalur REST punya cabang peran **per-endpoint**
masing-masing (`index.js`). Kontrak guest karena itu hidup di **dua** tempat,
dan keduanya harus diperiksa saat menambah endpoint.

---

## 4. Rute dan penjaganya

| Metode | Rute | Penjaga | Catatan |
|---|---|---|---|
| GET | `/health` | — | |
| GET | `/` | — | **Mencetak sesi guest** bila belum ada (lihat §6) |
| POST | `/auth/session` | — | Bearer → cookie `office_session` |
| POST | `/event` | `requireAuth` | sumber dipaksa dari identitas |
| POST | `/v1/traces` | `requireAuth` | OTLP, **JSON saja**; protobuf → 415 |
| GET | `/burn` | `requireAny` | angka USD **dinolkan** untuk guest |
| POST | `/budget/check` | `requireAuth` | **200 walau ditolak** |
| GET | `/policy` | `requireAny` | guest: room/label/trust/state/occupants saja |
| POST | `/policy/check` | `requireAuth` | rate limit 600/mnt, dicatat ke ledger |
| GET | `/approvals` | `requireAny` | guest: tanpa `agent`/`tool`, `redacted:true` |
| GET | `/approvals/:id` | `requireAuth` | bridge+owner; guest **403** |
| POST | `/approvals/:id` | `requireOwner` | sekali pakai, terikat `{agent,tool}` |
| POST | `/agents/:agent/room` | `requireOwner` | |
| GET | `/ledger`, `/ledger/head`, `/ledger/verify` | `requireOwner` | bridge **dikecualikan** |
| GET | `/kiosk` | `autoGuestSession` + `requireAny` | layar dinding; **menurunkan hak sendiri** — tanpa dolar bahkan untuk owner kecuali `?reveal=1` |
| GET | `/replay` | `requireOwner` | Time Machine; **tanpa versi tamu** — bukti berlubang bukan bukti |
| GET | `/ledger/anchors` | `requireOwner` | tambatan terbit + hasil perbandingan |
| POST | `/ledger/anchor` | `requireOwner` | terbitkan sekarang; **207** bila sebagian sink gagal |
| GET | `/standup` | `requireOwner` | bacaan pagi berperingkat; `?hours=`, `?format=md\|json`; tidak direkam ke rantai |
| GET | `/dossier` | `requireOwner` | `?from=&to=&format=md\|json` |
| GET | `/presence`, `/roster`, `/github/feed` | `requireAny` | |
| GET | `/debug/events` | `requireOwner` | |

---

## 5. Model keamanan — baca ini sebelum menambah endpoint

**Default rute baru BUKAN `requireAny`.** Sejak middleware auto-guest
mendarat, `GET /` mencetak sesi guest read-only untuk browser mana pun tanpa
kredensial. Server dipublikasikan lewat Tailscale Funnel, sehingga:

> **"pengunjung anonim di internet publik" dan "guest" adalah principal yang
> sama.** Setiap rute `requireAny` secara efektif dapat dibaca seluruh dunia.
> Redaksi guest bukan lagi pertahanan berlapis — ia **satu-satunya** batas.

Dipasak oleh 4 test integrasi yang menyerang dari sudut pandang browser anonim
sungguhan (ambil cookie dari `GET /`, lalu gunakan cookie itu), dan oleh 9 test
frontend pada `ApprovalGate`. Sesi yang sudah lebih kuat **tidak pernah**
diturunkan.

Detail lengkap: `SECURITY.md`.

---

## 6. Perekam penerbangan — klaim yang jujur

Hash: `SHA-256( canonicalJson({seq,ts,prevHash,type,actor}) + "\n" + payloadJson )`.
Posisi ikut di-hash, jadi penyusunan ulang terdeteksi.

| Serangan | Terdeteksi? |
|---|---|
| Edit isi rekaman | ✅ |
| Ubah timestamp | ✅ |
| Susun ulang rekaman | ✅ |
| Hapus di tengah | ✅ |
| Edit + hitung ulang hash | ✅ |
| **Potong ekor rantai** | ❌ |
| **Regenerasi rantai utuh** | ❌ |

Dua baris terakhir hanya tertutup oleh jangkar eksternal: salin
`GET /ledger/head` ke tempat yang tidak bisa dijangkau server ini — yang
sejak Fase 11 **sudah dibangun** (`anchor.js`, §lihat FLIGHT-RECORDER.md). Satu test
negatif memasak keterbatasan ini agar klaimnya tidak bisa menggelembung, dan
satu test frontend memasak kalimat "Tamper-evident, not tamper-proof" di UI.

Isi prompt dan completion **tidak pernah** direkam. Kegagalan tulis **tidak
pernah** menolak aksi.

Terukur: `FULL` 0,020 ms/rekaman ≈ 49k/dtk. 100k rekaman → tulis 2,1 dtk,
verifikasi 0,7 dtk, 31,3 MB → ~1,1 GB/tahun pada 10k keputusan/hari.

---

## 7. Lapisan visual (Fase 5)

Keputusan arsitektur: **aset pre-render + satu lapisan atmosfer WebGL**, bukan
3D real-time.

| Jalur | Bundle | React | Dipilih |
|---|---|---|---|
| Pre-render + shader | **+7,8 kB** | 18 | ✅ |
| Hybrid kamera 3D | ~+250 kB | wajib 19 | ✗ |
| Full 3D (GLB) | ~+250 kB + aset | wajib 19 | ✗ |

R3F v9 hanya berpasangan dengan React 19 sementara repo ini React 18.3.1. Lebih
menentukan: yang menjual kesan 3D pada donghua adalah **cahaya**, bukan
geometri — dan cahaya adalah fenomena per-frame yang tetap bisa dijalankan di
atas pelat statis.

- **18 pelat ruangan** (12 ruangan, varian siang/malam, @2x) — semua seni
  nyata, nol placeholder.
- **282 sprite** dikirim, 132 di antaranya bisa dibangun ulang byte-for-byte
  (lihat `docs/SPRITES.md`). **100 `derived`** lewat
  `scripts/stylize-donghua.py` — rim light searah god ray pelat, AO,
  specular, grade hangat, keyline; semua alpha-aware, idempoten, selalu
  membaca dari `art/originals/sprites/` dan tidak pernah dari keluarannya
  sendiri. **32 `built`** adalah cast donghua: 8 arketipe × 4 arah, diukur
  ulang dan dicerminkan dari 16 render di `art/donghua-cast/`. Sisa **150
  `unsourced`** adalah cast lama yang kini tidak dirender oleh apa pun.
- **`AtmosphereLayer.tsx`** membaca **burn state Fase 2**, jadi kantor berubah
  suhu seiring belanja naik. Lapisan tata kelola dan arah seni adalah hal yang
  sama.

Fallback: tanpa WebGL2 lapisan ini **tidak merender apa pun** dan ruangan tetap
tampil baik. Dipasak 10 test (jsdom tidak punya WebGL2, jadi jalur
terdegradasi teruji secara gratis).

---

## 8. Pengujian

| Lapisan | Jumlah | Perintah |
|---|---|---|
| Backend | **305** | `npm test` |
| Frontend | **136** | `cd frontend && npm test` |

Gerbang skrip, semuanya dijalankan CI:

| Skrip | Membuktikan |
|---|---|
| `check-shutdown.sh` | Keluar bersih dengan WebSocket aktif (P0: pernah menggantung) |
| `check-assets.sh` | 258 aset upstream utuh — tanpa perlu arsip 90 MB |
| `check-ci.sh` | Workflow terpasang cocok dengan sumber kanonik |
| `check-deployable.sh` | Nol host/akun hardcoded |

**Catatan penting soal CI:** sumber kanonik ada di **`ci/workflow.yml`**, bukan
hanya `.github/workflows/`. Alasannya tercatat di header berkas itu —
workflow-nya pernah ditulis, diverifikasi, lalu hilang dua kali, dan dua kali
pula CHANGELOG "dikoreksi" dengan penjelasan yang salah. Jalankan
`bash scripts/install-ci.sh` setelah clone.

**Urutan yang wajib:** satu test menyajikan SPA dari `frontend/dist`, jadi
frontend harus di-build **sebelum** `npm test`. Kalau tidak, satu test gagal
sendirian dan terlihat seperti flaky, bukan prasyarat yang kurang.

---

## 9. Deployment

Tidak ada satu pun host atau akun yang tertanam di kode. Integrasi opsional
**mati** sampai dikonfigurasi, dan melaporkan dirinya saat boot:

```json
{"log":"boot","port":7333,"githubPoller":"off","a2aMac":"off",
 "otlp":"off","ledger":"on","guestAutoSession":"off"}
```

Dulu tidak begitu: `HERMES_A2A_MAC_URL` default ke IP Tailscale satu mesin
tertentu dan `chat.js` mem-POST ke sana tanpa syarat, sementara `GITHUB_ORG`
default ke satu akun tertentu. Keduanya tampak "terkonfigurasi" dari luar.
`check-deployable.sh` mencegah itu kembali.

Variabel: lihat `.env.office.example` dan `DEPLOYMENT.md`. Port dari
**`OFFICE_PORT`** (bukan `PORT`).

---

## 10. Jebakan yang sudah memakan korban

Dicatat karena masing-masing sudah pernah menghabiskan waktu nyata:

1. **`agent` boleh string ATAU `{name,id,role}`.** Dua bug berlawanan sudah
   dikirim: menstringifikasi objek (`[object Object]` sebagai key Map) dan
   mensyaratkan string (membuang diam-diam setiap event bentuk-objek).
   Selalu normalkan ke `id ?? name`.
2. **Pencocokan nama model tidak boleh pakai `includes`.** `gpt-4o-mini`
   mengandung `gpt-4o`. Gunakan prefiks-terpanjang.
3. **Tipe event internal baru** harus ada di `KNOWN_EVENT_TYPES` **dan**
   `INTERNAL_ONLY`, dan emitternya harus mengirim `{internal:true}`.
4. **Transisi keadaan yang diam adalah lubang audit.** Setiap perubahan
   keadaan malas/implisit di `policy.js` wajib memancarkan event.
5. **Parser body tingkat-rute berjalan sebelum kode handler.** Penolakan
   content-type harus jadi middleware tersendiri, diurutkan lebih dulu.
6. **Dev proxy** harus memuat setiap rute. Daftarnya sudah salah dua kali;
   kini satu daftar `HTTP_ROUTES` eksplisit di `vite.config.ts`.
7. **Pemeriksa yang lolos bisa saja lolos karena kebetulan.**
   `check-docs.py` mem-*glob* `*.test.tsx` saja, jadi `agentManager.test.ts`
   (tanpa `x`) tak terlihat dan klaim "44 test frontend" lolos padahal
   sebenarnya ada 119. Pemeriksa kini menanyai runner-nya, bukan menghitung
   `it(` sendiri. Pemeriksa yang salah secara percaya diri lebih buruk
   daripada tidak ada pemeriksa.

8. **Fixture test harus cocok dengan server.** Tiga test ditulis dari asumsi
   dan gagal; ketiganya adalah tesnya yang salah, bukan kodenya.

---

## 11. Utang yang diketahui

- `docs/PRD.md` (359 baris) dan `docs/UI-SPEC.md` masih menggambarkan v1.
- `bridges/mac-relay/MAC-PLAYBOOK-TONIGHT.md` bersifat situasional.
- Belum ada Time Machine (replay + ekspor video), status page, multiplayer.
