# PRD — Hermes Office v2

**Status:** v2.0 · **Tanggal:** 6 Okt 2026 · **Pemilik:** Afrizal Munthe ("zaryu")

> **Dokumen ini menggantikan PRD v1.0 (3 Okt 2026) seluruhnya.** v1
> mendeskripsikan alat pribadi untuk melihat satu ekosistem agent. Produk yang
> sekarang ada di repo ini bukan itu. Ringkasan apa yang berubah dan mengapa
> ada di §13 — dibaca lebih dulu kalau Anda pernah membaca v1.

---

## 1. Ringkasan Eksekutif

Hermes Office adalah **ruang kendali spasial untuk armada AI agent**: kantor
isometrik bergaya donghua 3D di mana **denah lantai _adalah_ kebijakan**.
Setiap ruangan membawa tingkat kepercayaan, daftar alat yang diizinkan/ditolak,
plafon tier model, anggaran dolar per jam, dan aturan persetujuannya sendiri.
Memindahkan agent dari satu ruangan ke ruangan lain **mengubah apa yang boleh
ia lakukan** — bukan metafora, melainkan jalur penegakan yang sebenarnya.

Di bawah permukaan itu ada tiga pilar yang bisa dijual:

| Pilar | Apa | Status |
|---|---|---|
| **A** | **Ingest OTLP** — terima trace OpenTelemetry GenAI dari framework apa pun, normalisasi atribut yang berbeda-beda, hitung biaya | **Selesai** (Fase 1) |
| **B** | **Tata Kelola Spasial** — ruangan sebagai amplop kebijakan, breaker burn-rate, gerbang persetujuan | **Selesai** (Fase 2–3) |
| **C** | **Perekam Penerbangan + Ekspor Kepatuhan** — ledger berantai SHA-256, dossier AI Act | **Selesai** (Fase 4) |

**Tujuan satu kalimat:** *Satu halaman yang memperlihatkan apa yang armada agent
Anda lakukan, menghentikannya sebelum menghabiskan uang Anda, dan membuktikan
kepada auditor bahwa Anda sudah melakukan keduanya.*

---

## 2. Masalah & Bukti Pasar

### 2.1 Tiga masalah yang nyata

**Biaya lepas kendali.** IDC (Des 2025): **96% perusahaan melampaui proyeksi
biaya AI mereka, hanya 44% punya pengaman apa pun.** Tidak satu pun framework
agent besar mengirimkan **batas dolar native**. OWASP menamainya **LLM10 —
Denial of Wallet**. Yang ada di pasar adalah dashboard yang memberi tahu Anda
berapa yang sudah terbakar, setelah terbakar.

**Kepatuhan jadi wajib bulan ini.** Kewajiban sistem berisiko tinggi EU AI Act
berlaku **2 Agustus 2026** — sudah lewat. Pasal 12(1) mewajibkan pencatatan
otomatis; Pasal 19/26(6) menuntut retensi ≥6 bulan; Pasal 14 menuntut
pengawasan manusia; Pasal 99(4) memasang denda **€15 juta atau 3% omzet
global**. Standar de-facto untuk log yang tahan-rusak adalah
**append-only + rantai SHA-256**.

**Telemetri tidak seragam.** Semconv GenAI OpenTelemetry punya repo sendiri
sejak v1.42.0 (12 Jun 2026) tapi **belum ada rilis bertag** — semuanya masih
berstatus *Development*. Framework memancarkan **beberapa generasi atribut
sekaligus**. Normalisasi bukan pekerjaan sepele; itu pekerjaan yang bisa
dijual.

### 2.2 Mengapa ada ruang untuk kami

Sapuan kompetitor GitHub (4 Okt 2026): kategori "kantor piksel lucu" mentok di
sekitar **200 bintang** — `W17ant/Claude-Office` 191★ (hulu kami, dorongan
terakhir 2026-04-16, mandek), `FulAppiOS/Agent-Quest` 142★, sisanya ≤17★.
Dashboard observability yang tidak lucu jauh lebih besar: `patoles/agent-flow`
1.673★, Arize Phoenix 11.703★, **Langfuse 35.372★**.

Pelajarannya **bukan** "jadilah lucu". Keimutan tidak berskala jadi bisnis.
Yang berskala adalah **tata kelola**; metafora spasial adalah antarmuka yang
membuat tata kelola bisa dipahami sekilas.

**Yang jangan dilawan:** Claude Code v2.1.139 (11 Mei 2026) sudah mengirimkan
Agent View native. Vendor memiliki pertanyaan "apa yang sedang berjalan". Kami
menjawab pertanyaan yang berbeda: *apa yang boleh berjalan, berapa biayanya,
dan bisakah Anda membuktikannya enam bulan dari sekarang.*

### 2.3 Harga yang sudah terbukti di pasar

Langfuse $29 / $199 / **$2.499 Enterprise**. Braintrust gratis → $249 (Seri B
**$80 juta @ valuasi $800 juta**, Feb 2026). LangSmith $39/kursi + $0,50–2,50
per 1.000 trace. Laminar $30/$150 dengan **kursi tak terbatas**.

---

## 3. Goals & Non-Goals

### 3.1 Goals v2

| # | Goal | Status |
|---|---|---|
| G1 | Terima trace OTLP GenAI dari framework apa pun, normalisasi lintas-generasi atribut | ✅ Fase 1 |
| G2 | Denah lantai sebagai amplop kebijakan yang dapat ditegakkan | ✅ Fase 3 |
| G3 | Breaker burn-rate yang **mengarahkan sebelum menghentikan** | ✅ Fase 2 |
| G4 | Ledger tahan-rusak + ekspor dossier AI Act | ✅ Fase 4 |
| G5 | Bisa di-deploy siapa pun, tanpa terikat host/akun mana pun | ✅ Fase 6 |
| G6 | Identitas visual yang membenarkan harga premium | ✅ Fase 5 |
| G7 | Pengujian yang membuat refactor aman (154 backend + 119 frontend) | ✅ Fase 7, 9 |
| G8 | Dokumentasi yang klaimnya dieksekusi CI | ✅ Fase 8 |

### 3.2 Non-Goals v2

- ❌ **Bersaing dengan Agent View milik vendor.** Kalah sebelum mulai.
- ❌ **Harga per-kursi.** Pembeli kami adalah tim kecil dengan armada besar.
  Laminar membuktikan kursi tak terbatas laku. Per-kursi menghukum tepat
  perilaku yang kami ingin dorong.
- ❌ **Multi-tenant SaaS.** Single-tenant yang di-self-host adalah fiturnya —
  pembeli kepatuhan tidak mau log mereka di infrastruktur orang lain.
- ❌ **Migrasi ke React 19 / React Three Fiber.** Lihat §11 D3.
- ❌ **Membaca isi prompt.** Lihat §11 D5. Ini batas permanen, bukan backlog.
- ❌ Aplikasi native mobile.

---

## 4. Persona & User Story

### Persona 1: Engineering Lead (pembeli & pemakai harian)

- **US1:** Saya membuka satu halaman dan melihat agent mana di ruangan mana,
  karena ruangan memberi tahu saya apa yang boleh mereka sentuh.
- **US2:** Ketika seorang agent mencoba `kubectl` dari meeting-room, ia
  ditolak dan saya melihat alasannya — bukan menemukannya di log besok.
- **US3:** Saat belanja mencapai 75% anggaran, kantor berubah warna sebelum
  ada yang perlu membaca angka.

### Persona 2: Petugas Kepatuhan / Auditor (pembenar anggaran)

- **US4:** Saya mengunduh dossier untuk rentang tanggal dan mendapat catatan
  tahan-rusak berisi setiap keputusan, persetujuan, dan penolakan.
- **US5:** Saya memverifikasi rantai dan mendapat jawaban ya/tidak, bukan
  "percayalah".
- **US6:** Saya bisa melihat dengan tepat apa yang **tidak** dideteksi sistem
  ini (§ FLIGHT-RECORDER) tanpa harus membaca kodenya.

### Persona 3: Finance / FinOps

- **US7:** Saya memasang plafon dolar per ruangan dan sistem **mengarahkan**
  agent ke model lebih murah dulu, menghentikan hanya sebagai upaya terakhir.
  (TokenOps Microsoft: tata kelola tingkat-run memangkas belanja per-tugas
  **~78%** dan menaikkan penyelesaian 67%→96% justru dengan mengarahkan,
  bukan menghentikan.)

### Persona 4: Tamu / pengunjung anonim

- **US8:** Saya melihat kantor hidup dan paham produknya dalam 10 detik,
  **tanpa** melihat satu pun dolar, nama alat, atau identitas pemberi
  persetujuan.

> ⚠ Persona 4 bukan hipotetis. `GET /` mencetak sesi tamu read-only untuk
> browser mana pun yang belum punya. Kalau instance disajikan ke internet,
> **"pengunjung anonim" == "tamu"**, dan redaksi tamu adalah satu-satunya
> batas yang ada. Lihat SECURITY.md §3.

---

## 5. Arsitektur (sebagaimana dibangun)

```
  Sumber telemetri                 Hermes Office                    Browser
 ┌──────────────────┐        ┌────────────────────────┐        ┌─────────────┐
 │ Framework agent  │ OTLP   │  POST /v1/traces       │        │             │
 │ apa pun          ├───────►│  normalisasi + biaya   │        │  React DOM  │
 └──────────────────┘        │         │              │        │  isometrik  │
 ┌──────────────────┐ POST   │         ▼              │        │             │
 │ Hook/relay Anda  ├───────►│   event bus ──────────────── WS ►│ AtmosphereL │
 └──────────────────┘ /event │     │        │         │        │ (shader)    │
 ┌──────────────────┐ poll   │     ▼        ▼         │        │             │
 │ GitHub (opsional)├───────►│  policy   burn-rate    │        │ BurnOverlay │
 └──────────────────┘        │     │        │         │        │ ApprovalGate│
                             │     └────┬───┘         │        │ AuditBadge  │
                             │          ▼             │        └─────────────┘
                             │   ledger (SHA-256)     │
                             │          │             │        ┌─────────────┐
                             │          ▼             │  GET   │  Auditor    │
                             │   GET /dossier ────────────────►│  (dossier)  │
                             └────────────────────────┘        └─────────────┘
```

Detail per-modul, tabel rute lengkap, dan diagram aliran data ada di
**ARCHITECTURE.md** — dokumen itu klaimnya diverifikasi CI lewat
`scripts/check-docs.py`, jadi ia yang jadi sumber kebenaran teknis, bukan PRD
ini.

---

## 6. Spesifikasi Fitur (sebagaimana dibangun)

### F1 · Ingest OTLP (Fase 1)

`POST /v1/traces`, JSON saja, token bridge, batas 8 MB, 2.000 event per batch.
Protobuf ditolak dengan **415** yang menyebutkan
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` — pesan error yang mengajari, bukan
yang menyalahkan. Penampakan pertama sebuah agent otomatis menyuntik
`agent_spawned` bertanda `synthetic:true`. int64 ditangani **sebagai string**.
`status.code===2` → `ok:false`. Biaya: `gen_ai.usage.cost` menang kalau ada,
jika tidak pencocokan prefiks terpanjang atas tabel harga.

### F2 · Tata Kelola Spasial (Fase 3)

Setiap ruangan:
`{label, trust, tools:{allow,deny}, maxModelTier, budgetHourlyUsd, approval[], entryApproval}`.

| Ruangan | Anggaran/jam | Catatan |
|---|---|---|
| lobby | $0,25 | zona masuk |
| meeting-room | $1 | menolak `bash shell deploy kubectl terraform psql` |
| main-office | $2 | kerja umum |
| server-room | $5 | + persetujuan + persetujuan masuk |
| ceo-office | $10 | kepercayaan tertinggi |
| kitchen / nap-room | 0 | idle — menolak segalanya, disengaja |

`decide()` berurutan: idle → **deny mengalahkan allow** → tier model →
pencocokan glob persetujuan → amplop ruangan → `burn.decide()`.
**Lingkup paling ketat yang menang.** Persetujuan `ap-<seq>-<base36>`, TTL 5
menit, **sekali pakai, terikat ke `{agent, tool}`**, resolusi ganda → 409.

### F3 · Breaker Burn-Rate (Fase 2)

`<0.5 normal` → `<0.75 warm` → `<0.9 hot` → `<1.0 critical` → `>=1.0 tripped`,
dengan aksi `allow | advise | restrict | throttle | deny`.

Desainnya **mengarahkan sebelum menghentikan**. `budget_state` disiarkan
**hanya saat transisi**, dan tidak pernah membawa angka dolar — jadi tamu
melihat suhu tanpa melihat uang.

### F4 · Perekam Penerbangan + Dossier (Fase 4)

`SHA-256( canonicalJson({seq,ts,prevHash,type,actor}) + "\n" + payloadJson )`,
genesis `"0"×64`.

| Terdeteksi oleh rantai saja | Butuh tambatan (Fase 11) | Masih tidak terdeteksi |
|---|---|---|
| penyuntingan record | pemotongan ekor | kebohongan tentang **masa depan** |
| perubahan timestamp | regenerasi menyeluruh | — |
| penyusunan ulang | — | — |
| penghapusan di tengah | — | — |

Kolom tengah ditutup Fase 11 dengan **menerbitkan hash kepala ke luar
ledger**: berkas JSONL di samping basis data (lemah, gratis) dan webhook
operator opsional (kuat). Begitu `{seq, hash}` ada di tangan orang lain,
server tidak bisa lagi berpura-pura rantainya berakhir lebih awal. Ia tetap
bisa berbohong soal masa depan; ia tidak bisa menarik kembali yang sudah
terbit. UI
menyebut ini apa adanya: *"Tamper-evident, not tamper-proof."*

Terukur: 0,020 ms/record ≈ 49.000/detik; 100.000 record → verifikasi 0,7 s,
31,3 MB ≈ 1,1 GB/tahun. Isi prompt **tidak pernah** dicatat. Kegagalan tulis
ledger **tidak pernah** menolak aksi yang sedang berjalan.

### F5 · Lapisan Visual Donghua (Fase 5)

12 ruangan, 18 pelat, 282 sprite, nol placeholder. Kesan 3D datang dari
**cahaya**, bukan geometri: satu fragment shader WebGL2 (`AtmosphereLayer`)
dengan god ray volumetrik, debu di tiga bidang parallax, vignette, dan
gradasi warna yang **membaca burn state**. Biaya **+7,8 kB**.

### F6 · Chat & Panel (warisan v1, dipertahankan)

Chat bergaya Slack dengan reaksi, typing indicator, thread, dan tanda dibaca —
semuanya persisten di SQLite. Feed GitHub opsional. Niu-mode masih **stub**
(palet + string Indonesia di `niu.ts`, toggle `/niu`), bukan tema penuh seperti
yang dijanjikan UI-SPEC v1.

---

## 7. Model Data

```sql
-- server/chat-db.js
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sender     TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'default',
  text       TEXT    NOT NULL,
  timestamp  INTEGER NOT NULL,
  is_system  INTEGER NOT NULL DEFAULT 0,
  reactions  TEXT    NOT NULL DEFAULT '[]',   -- array JSON, bukan tabel terpisah
  thread_id  INTEGER,
  seen       INTEGER NOT NULL DEFAULT 0
);

-- server/ledger.js
CREATE TABLE IF NOT EXISTS ledger ( ... );   -- append-only, berantai hash
```

Event **tidak** disimpan di SQLite. Mereka hidup di ring buffer dalam memori
(100.000 entri / 7 hari). Hanya chat dan ledger yang persisten — ledger karena
kepatuhan menuntutnya, chat karena pengguna mengharapkannya.

> PRD v1 menjanjikan tabel `events` dan tabel `reactions` terpisah. Keduanya
> tidak pernah dibangun seperti itu; dokumen ini mencerminkan skema yang nyata.

---

## 8. Spesifikasi API

26 rute tingkat-atas + 7 sub-rute chat. **ARCHITECTURE.md memuat tabel lengkap
beserta guard tiap rute, dan `scripts/check-docs.py` memverifikasi tabel itu
dua arah** — rute di `index.js` tanpa baris tabel gagal, rute terdokumentasi
yang tidak ada juga gagal.

Ringkasan per-pilar:

| Pilar | Rute |
|---|---|
| Ingest | `POST /v1/traces`, `POST /event` |
| Tata kelola | `GET /policy`, `POST /policy/check`, `POST /budget/check`, `GET /burn`, `POST /agents/:agent/room` |
| Persetujuan | `GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id` |
| Kepatuhan | `GET /replay`, `GET /ledger`, `GET /ledger/head`, `GET /ledger/verify`, `GET /ledger/anchors`, `POST /ledger/anchor`, `GET /dossier` |
| Kantor | `GET /`, `GET /roster`, `GET /presence`, `GET /github/feed`, `GET /health`, `GET /debug/events`, `POST /auth/session` |
| Chat | `GET /chat`, `POST /chat`, `POST /chat/completions`, `POST /chat/reply`, `POST /chat/react`, `POST /chat/typing`, `POST /chat/seen` |

---

## 9. Kemasan & Harga

| Tier | Harga | Isi |
|---|---|---|
| **Open core** | $0 | Kantor, event bus, chat, feed GitHub. Lisensi MIT dari hulu. |
| **Solo Pro** | $39 | Ingest OTLP, burn-rate, kebijakan ruangan |
| **Team** | $299 | + perekam penerbangan, gerbang persetujuan, **≤10 kursi** |
| **Enterprise** | $2.000+ | + ekspor dossier AI Act, penambatan ledger, SSO, dukungan |

**Pilar C adalah yang mengubah $299 menjadi $2.000+.** Pembeli berubah dari
engineering lead yang membelanjakan anggaran tim menjadi petugas kepatuhan
yang membelanjakan anggaran risiko, dan angka pembandingnya bukan lagi harga
alat melainkan **€15 juta**.

**Jangan pernah per-kursi.** Diulang di sini karena tekanannya akan datang.

---

## 10. Roadmap yang Tersisa

Tiga pilar sudah selesai. Yang berikutnya adalah **penguat**, bukan fondasi —
diurutkan berdasarkan nilai komersial per satuan usaha:

| # | Ide | Mengapa berharga |
|---|---|---|
| R5 | **Multiplayer (Durable Objects)** | Beberapa penonton melihat kantor yang sama |
| R6 | **Marketplace sprite** | Pendapatan komunitas; risiko rendah, imbalan rendah |

Utang yang diketahui ada di ARCHITECTURE.md §11, bukan di sini — supaya hanya
ada satu daftar.

---

## 11. Keputusan Desain (ADR)

| # | Keputusan | Alternatif | Alasan |
|---|---|---|---|
| **D1** | Denah lantai sebagai penegakan kebijakan, bukan dekorasi | Dashboard dengan tabel aturan | Satu-satunya hal yang tidak dimiliki Langfuse/Phoenix. Metafora spasial membuat kebijakan bisa dibaca sekilas. |
| **D2** | Mengarahkan sebelum menghentikan | Pemutus keras di 100% | Data TokenOps: mengarahkan memangkas belanja ~78% **dan** menaikkan penyelesaian 67%→96%. Pemutus keras hanya memangkas biaya. |
| **D3** | Pelat pra-render + satu shader | React Three Fiber | R3F@9 butuh React 19 → migrasi menyentuh 15 komponen; three ~150–200 kB setelah tree-shake + ~50 kB reconciler. Yang kami kirim: **+7,8 kB**. |
| **D4** | Disiplin token OKLCH saja | Migrasi penuh Tailwind v4 + shadcn | 2.475 baris CSS yang berfungsi membuat penulisan ulang jadi biaya murni. Ambil ide warnanya, tinggalkan migrasinya. |
| **D5** | Tidak pernah membaca isi prompt | Ingest prompt penuh untuk fitur lebih kaya | Pembeli kepatuhan tidak akan memasang alat yang menyedot prompt. Ini pagar permanen. |
| **D6** | Single-tenant self-hosted | SaaS multi-tenant | Sama: pembeli kepatuhan tidak mau log mereka di tempat lain. |
| **D7** | Tahan-rusak, bukan tahan-serang — dan mengatakannya | Diam saja soal batasannya | Auditor yang menemukan sendiri batasannya tidak akan memercayai klaim lain mana pun. |

---

## 12. Risiko

| # | Risiko | Prob. | Dampak | Mitigasi |
|---|---|---|---|---|
| R1 | **Auto-guest** membuat instance publik tanpa disadari | Tinggi | Tinggi | Redaksi tamu diuji di dua tempat; terdokumentasi menonjol; `state`+`ratio` sengaja lolos |
| R2 | Semconv GenAI berubah sebelum rilis bertag | Tinggi | Sedang | Normalisasi sudah menangani banyak generasi; itu justru produknya |
| R3 | Vendor menambahkan tata kelola biaya native | Sedang | Tinggi | Pilar C (kepatuhan) paling sulit ditiru vendor; perdalam di sana |
| R4 | Ekor ledger dipotong tanpa terdeteksi | Rendah | Tinggi | **Ditutup Fase 11** lewat penambatan. Sisa risiko: tambatan lokal-saja lemah terhadap root — pasang `OFFICE_ANCHOR_WEBHOOKS` |
| R5 | Pembeli menuntut harga per-kursi | Sedang | Sedang | Tolak; tunjukkan preseden kursi-tak-terbatas Laminar |
| R6 | Dokumentasi melampaui kenyataan (sudah terjadi 3×) | Tinggi | Sedang | `scripts/check-docs.py` di CI; dokumen ini masuk cakupannya |
| R7 | Berkas/direktori hilang antar lingkungan (`.github/`, `node_modules`) | Tinggi | Rendah | Sumber kanonik + skrip pemasang + pemeriksa drift |

---

## 13. Apa yang Berubah dari v1

| v1 menjanjikan | Kenyataan |
|---|---|
| "Pusat komando visual untuk ekosistem saya" | Produk tata kelola yang bisa dijual untuk armada siapa pun |
| Terikat pada Hermes Cloud + Mac + org Niumination | **Nol** nilai default khusus-host; `GITHUB_ORG` dan `HERMES_A2A_MAC_URL` kini `""` |
| `GITHUB_ORG` default `"Niumination"` | Default itu **tidak akan pernah berhasil** — `Niumination` adalah User, bukan Org; `/orgs/.../repos` → 404 |
| Tabel `events` + tabel `reactions` di SQLite | Event di ring buffer memori; reaksi berupa kolom JSON |
| `/api/agents` | Tidak pernah dibangun; `/roster` + `/presence` yang mengisi perannya |
| Niu-mode sebagai tema penuh | Stub: palet + string + toggle `/niu` |
| Convetti, music box, gamelan | Tidak dibangun. Dihapus dari spec, bukan ditunda. |
| "canvas ~70% width, tile grid" | Bukan canvas sama sekali — **React DOM** dengan posisi persentase |
| Pixel art | Donghua 3D (Fase 5) |
| 12–16 hari untuk v1.0 | v1.0 terkirim; v2 menambah Fase 0–9 di atasnya |

**Yang tidak berubah, dan tidak boleh berubah:** model token per-sumber,
pipeline redaksi, kontrak privasi `channel_msg`, dan sanitasi tamu.

---

## 14. Definition of Done — v2.0

- [x] Ingest OTLP menerima dan menormalkan trace GenAI lintas-generasi
- [x] Kebijakan ruangan ditegakkan di `decide()`, bukan hanya ditampilkan
- [x] Burn-rate mengarahkan di 4 ambang sebelum menolak
- [x] Ledger berantai SHA-256 + `GET /ledger/verify` + ekspor dossier
- [x] Batasan ledger dinyatakan di UI dan di dokumen
- [x] Nol pengikatan ke host/akun mana pun (`check-deployable.sh`)
- [x] 154 test backend + 119 test frontend hijau
- [x] Lint bersih, build 216 kB
- [x] 5 skrip pemeriksa lolos, semuanya di CI, tanpa `|| true`
- [x] Klaim ARCHITECTURE.md dieksekusi CI
- [x] Penambatan ledger — pemotongan ekor dan regenerasi kini terdeteksi (Fase 11)

---

## 15. Dokumen Terkait

| Dokumen | Isi |
|---|---|
| `ARCHITECTURE.md` | **Sumber kebenaran teknis.** Diverifikasi CI. |
| `OTLP.md` | Kontrak ingest, normalisasi atribut, model biaya |
| `BURN-RATE.md` | Ambang, aksi, perilaku transisi |
| `POLICY.md` | Skema ruangan, urutan `decide()`, siklus hidup persetujuan |
| `STANDUP.md` | Bacaan pagi: ambang temuan, determinisme, apa yang rantai tak bisa klaim |
| `KIOSK.md` | Layar dinding: penurunan hak otomatis, basi, auto-guest |
| `REPLAY.md` | Time Machine: determinisme, pra-gulung, batas |
| `FLIGHT-RECORDER.md` | Konstruksi rantai, apa yang tidak dideteksi, angka kinerja |
| `SECURITY.md` | Model ancaman, auto-guest, kontrak tamu |
| `EVENTS.md` | 12 event publik + 5 internal |
| `DEPLOYMENT.md` | Operasi, variabel env, matikan-dengan-rapi |
| `UI-SPEC.md` | Bahasa visual, layout, aksesibilitas |
| `CHANGELOG-v2.md` | Catatan lengkap Fase 0–9, termasuk yang salah |
