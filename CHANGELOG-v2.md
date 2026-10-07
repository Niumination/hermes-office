# Hermes Office v2 — Catatan Perubahan

- **Fase 0** — perbaikan fondasi (di bawah)
- **Fase 1** — ingest OTLP ([lompat ke bagian ini](#fase-1--ingest-otlp))
- **Fase 2** — burn-rate governance ([lompat ke bagian ini](#fase-2--burn-rate-governance))
- **Fase 3** — policy as floor plan ([lompat ke bagian ini](#fase-3--policy-as-floor-plan))
- **Fase 4** — flight recorder & compliance dossier ([lompat ke bagian ini](#fase-4--flight-recorder--compliance-dossier))
- **Audit pra-Fase 4** — regresi kebocoran guest & utang P3 ([lompat ke bagian ini](#audit-pra-fase-4--perbaikan-regresi--utang-okt-2026))
- **Sinkronisasi upstream** — ZIP kedua, auto-guest & presence ([lompat ke bagian ini](#sinkronisasi-dengan-upstream--hermes-office-main-2zip-5-okt-2026))
- **Fase 5 — Tema Donghua 3D** — seni ruangan, stilisasi sprite, atmosfer WebGL ([lompat ke bagian ini](#fase-5--tema-donghua-3d-6-okt-2026))
- **Fase 6 — Bisa dipasang orang lain** — cabut host hardcoded, hapus poller ganda ([lompat ke bagian ini](#fase-6--bisa-dipasang-orang-lain-6-okt-2026))
- **Fase 7 — Test frontend** — permukaan tata kelola akhirnya diuji ([lompat ke bagian ini](#fase-7--test-frontend-6-okt-2026))

---

# Fase 0: Perbaikan Fondasi

Fork bersih dari `hermes-office` v1.0.0. Repo lama tetap utuh sebagai arsip.
Fase 0 **tidak menambah fitur** — tujuannya satu: membuat basis kode ini layak
dijual dan layak di-deploy. Semua klaim di bawah diverifikasi empiris, bukan
hasil pembacaan kode.

---

## Ringkasan dampak

| Metrik | Sebelum | Sesudah |
|---|---|---|
| Muat halaman pertama (latar) | 19.052.252 byte | 102.248 byte (**−99,5%**) |
| Total `frontend/public/` | 87 MB | 32 MB |
| `npm ci` (root + frontend) | gagal/hang ~70 dtk | 1 dtk + 1 dtk |
| `node --test tests/` | **menggantung selamanya** | 22/22 lulus, keluar 3,8 dtk |
| SIGTERM dengan WebSocket aktif | **hang → butuh SIGKILL** | keluar bersih 106 ms |
| Aset hilang | 200 + index.html | 404 asli |
| Ruangan tanpa latar | 8 | 0 |

---

## P0 — Pemblokir deploy

### 1. Lockfile terikat mirror pihak ketiga
105/105 dependensi root dan 115/115 frontend punya URL `resolved` ke
`http://mirrors.tencentyun.com/npm/` — HTTP polos, mirror pihak ketiga.
`deploy.sh` memakai `set -euo pipefail`, jadi mati di langkah pertama di mesin
mana pun di luar jaringan itu.

- Kedua lockfile diregenerasi terhadap `registry.npmjs.org`.
- Ditambahkan `.npmrc` (root + `frontend/`) yang memaku registry.
- Verifikasi: `npm ci` bersih, 105 dan 68 paket, masing-masing 1 detik.

### 2. Shutdown menggantung dengan WebSocket aktif
`httpServer.close()` hanya menghentikan koneksi *baru*; ia menunggu koneksi
hidup selesai. WebSocket tidak pernah selesai sendiri — jadi `systemctl restart`
macet sampai `TimeoutStopSec` default 90 detik memicu SIGKILL. **Setiap deploy
kehilangan checkpoint WAL SQLite.**

Perbaikan di `server/index.js`:
- Tutup semua klien WS dengan kode `1001` (*going away*), lalu `wss.close()`.
- `closeIdleConnections()` segera; `closeAllConnections()` pada 2 dtk.
- Batas waktu 5 dtk ber-`unref()` sebagai jaring pengaman — proses tidak bisa
  melampauinya.
- Penjaga `shuttingDown` agar SIGTERM ganda tidak saling injak.
- `TimeoutStopSec=10`, `KillSignal=SIGTERM`, `KillMode=mixed` di unit systemd.

Verifikasi: `scripts/check-shutdown.sh` — melampirkan WebSocket sungguhan,
menegaskan `wsClients>=1` (agar ujiannya tidak hampa), lalu SIGTERM.
Hasil: **keluar bersih 106 ms**, klien menerima kode tutup 1001.

---

## P1 — Kerusakan fungsional

### 3. Test menggantung selamanya
`node --test tests/` tidak pernah keluar. Penyebabnya sama: `wsConnect()`
membuka socket yang tidak pernah ditutup, sehingga event loop proses test tetap
hidup. `after()` hanya mengirim SIGTERM ke server, tidak pernah menutup socket.

- Semua socket didaftarkan di `OPEN_SOCKETS`, di-`terminate()` pada `after()`.
- `after()` kini **menunggu** server benar-benar keluar — jadi suite ikut
  menguji graceful shutdown. Eskalasi ke SIGKILL hanya jika lewat 8 detik.

### 4. CI tidak pernah bisa gagal
`npm ci || npm install` menyembunyikan lockfile rusak; `node --test tests/ || true`
membuang hasilnya. Lint hanya `node --check` atas 3 berkas.

- `|| install` dan `|| true` dihapus.
- `timeout-minutes` di setiap job (test yang hang dulu bisa membakar 6 jam runner).
- `node --check` atas **semua** `server/*.js`.
- Dua gerbang baru: `check-shutdown.sh`, dan pemeriksa bahwa setiap path
  `/sprites|/rooms|/assets` yang dirujuk di kode benar-benar ada di disk.

### 5. Poller GitHub 404 selamanya
`server/github.js` memanggil `/orgs/${githubOrg}/repos`. Diverifikasi lewat API:
`Niumination` adalah **User**, bukan Organization — `/orgs/Niumination` → 404,
`/users/Niumination/repos` → 200 (89 repo). Error ditelan dan diulang tiap 60 detik.
Klaim README "polling org Niumination (128 repo)" tidak pernah benar.

- Tipe akun dideteksi sekali lewat `/users/{owner}` lalu di-cache.
- Override manual via `GITHUB_OWNER_TYPE=user|org`.

### 6. Agen cloud macet berstatus `away`
Dua bug bertumpuk:
- **Server:** hanya `agent_status` yang menyegarkan heartbeat. Agen yang sibuk
  mengirim `tool_call` selama >90 dtk tetap ditandai *away* padahal sedang bekerja.
  Kini **setiap** event yang bisa diatribusikan ke agen (`agentId`, `agent`,
  `a2a_task_in.dest`, `a2a_task_out.origin`) menyegarkan heartbeat. Event `away`
  terbitan watchdog sendiri tetap dikecualikan agar agen mati tidak bangkit sendiri.
- **Bridge:** `handler.py` mengirim `agent_status` tepat sekali (`_SENT_STARTUP`)
  lalu diam. Relay mac sudah punya `HEARTBEAT_EVERY=30`; cloud tidak.
  Ditambahkan thread daemon heartbeat 30 detik.

Ambang watchdog kini dapat dikonfigurasi (`OFFICE_WATCHDOG_CUTOFF_MS`,
`OFFICE_WATCHDOG_SWEEP_MS`) — tanpa itu transisi *away* butuh 2 menit untuk diuji.

Test baru membuktikan perbaikan ini: dijalankan terhadap logika lama ia **gagal**,
terhadap logika baru ia **lulus**.

### 7. Aset 18 MB per latar
`rooms.ts` dan `assets.ts` menunjuk PNG 4800×3584. Varian 1200×896 (`-dm`) sudah
ada tapi tak terpakai. `assets.ts` juga mendeklarasikan `width:800, height:600`
yang keliru untuk gambar tersebut.

- Semua latar → WebP: 1× (1200×896) + 2× (2400×1792) untuk layar retina.
  `office-day`: **18,17 MB → 102 KB** (1×) + 253 KB (2×).
- 250 sprite → WebP lossless (pixel art tetap tajam): 15,9 MB → 10,2 MB.
  Sprite yang justru membesar dibiarkan sebagai PNG.
- Semua PNG lama dihapus, termasuk varian `-dm` yang tak terpakai.
- Dimensi di `assets.ts` dikoreksi ke 1200×896.
- `express.static` kini mengirim `Cache-Control`: bundel ber-hash
  `immutable, max-age=1y`; gambar `max-age=1d`; HTML `no-cache`.

---

## P2 — Ketepatan

### 8. Catch-all SPA menelan 404
`/^\/(?!ws$).*/` menjawab 200 + `index.html` untuk *segala* path, termasuk
sprite yang salah ketik — muncul sebagai gambar rusak tanpa sinyal apa pun di
network tab. Namespace `/sprites/`, `/rooms/`, `/assets/` kini dikecualikan dan
mengembalikan 404 sungguhan.

### 9. Delapan ruangan tanpa latar
Dari 12 ruangan, 8 tidak punya aset sama sekali. Dibuatkan latar placeholder
prosedural (gradien + grid isometrik + label `PLACEHOLDER ART`) agar UI utuh dan
status "belum digarap" terbaca jujur. Art sungguhan adalah pekerjaan Fase 1.

### 10. Proxy Vite menunjuk port yang salah
Target `localhost:3334`; server mendengarkan di `OFFICE_PORT` (default 7333).
Semua panggilan API di mode dev 404. Rute `/event`, `/health`, `/presence`,
`/github`, `/auth` juga tidak terdaftar sama sekali.
Port kini mengikuti `OFFICE_PORT`, kedelapan rute terdaftar.

### 11. `agentForEnvelope` menghasilkan `"[object Object]"`
`String(d.agent ?? d.agent?.name ?? '')` — `??` hanya jatuh ke cabang berikutnya
pada `null`/`undefined`, jadi `agent` berupa objek (persis yang dikirim
`handler.py`) distringifikasi jadi `"[object Object]"`. Kini tipe diperiksa dulu,
lalu `name` → `id`.

### 12. `emitInternal` melewati pipeline ingest
Event internal ditulis langsung ke ring buffer — tanpa validasi, clamping, atau
redaksi. Event internal cacat atau yang membawa rahasia akan sampai ke semua
klien tanpa diperiksa. Kini melewati `bus.ingest()` dengan `skipRateLimit`.

---

## Yang sengaja tidak diubah

Model token per-sumber, pipeline redaksi 8 pola, kontrak privasi `channel_msg`,
dan sanitasi guest sisi server — keempatnya sudah lebih matang daripada banyak
produk berbayar. Tidak disentuh.

---

## Verifikasi

```
npm ci                      105 paket, 1 dtk
cd frontend && npm ci        68 paket, 1 dtk
npm run build               ✓ 57 modul, 13,6 dtk
node --test tests/          22/22 lulus, keluar 3,8 dtk
bash scripts/check-shutdown.sh   PASS, keluar bersih dengan WS aktif
```

Pemeriksaan regresi langsung terhadap daftar temuan audit:

| Pemeriksaan | Hasil |
|---|---|
| `/health` | 200 |
| `/roster` tanpa token | 401 |
| owner `POST /event` | 403 |
| Origin tidak dikenal | 403 |
| `/sprites/tidak-ada.webp` | 404 (dulu 200+HTML) |
| rute SPA acak | 200 HTML |
| `ghp_…` dalam detail event | `[REDACTED]` |
| `Cache-Control` pada aset | `public, max-age=86400` |

---

## Catatan migrasi

1. **Aset berubah ekstensi.** Semua `.png` di `frontend/public/` kini `.webp`.
   Integrasi di luar repo yang menautkan path PNG harus diperbarui.
   WebP didukung semua browser utama sejak 2020.
2. **Variabel lingkungan baru** (semuanya opsional, ada nilai default):
   `GITHUB_OWNER_TYPE`, `OFFICE_WATCHDOG_CUTOFF_MS`, `OFFICE_WATCHDOG_SWEEP_MS`,
   `OFFICE_HEARTBEAT_EVERY` (sisi bridge).
3. **Unit systemd berubah** — jalankan ulang `scripts/install-service.sh` lalu
   `systemctl daemon-reload` agar `TimeoutStopSec` berlaku.
4. **Aset hilang kini 404.** Jika ada kode yang diam-diam mengandalkan
   catch-all mengembalikan HTML, ia akan terlihat sekarang. Itu memang tujuannya.

---

## Belum dikerjakan (P3, tertunda ke Fase 1)

Direktori yatim `bridges/hermes-cloud-plugin/`, body middleware kosong,
`sanitizeEventForGuest` duplikat, impor `randomUUID` tak terpakai,
`RateLimiter.hits` yang tidak pernah dibersihkan, 14 IP/hostname Tailscale
ter-hardcode, dan ketiadaan linter. Pemindaian rahasia: **bersih**.

---

# Fase 1 — Ingest OTLP

**Ini perubahan yang mengubah siapa yang bisa membeli produk ini.**

Sebelumnya Hermes Office hanya bisa diberi makan oleh dua bridge miliknya
sendiri, jadi pasarnya terbatas pada "orang yang menjalankan Hermes" — satu
orang. Sekarang ia menerima OpenTelemetry GenAI di `POST /v1/traces`. Apa pun
yang bisa mengarahkan exporter OTLP ke sebuah URL menjadi terlihat di lantai
kantor: Claude Code, VS Code Copilot, OpenAI Codex, LangChain, LlamaIndex,
Pydantic AI, CrewAI, OpenLLMetry, atau instrumentasi SDK Anda sendiri.

Integrasi penuhnya hanya ini:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://office-host:7333
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer $OFFICE_OTLP_TOKEN"
```

Dokumentasi lengkap: `docs/OTLP.md`.

## Lapisan normalisasi — ini nilai jual sebenarnya

Semantic conventions GenAI pindah ke repo tersendiri di v1.42.0 (12 Jun 2026)
dan **setiap atribut masih berstatus *Development*** — belum ada yang
dibekukan, belum ada rilis bertag. Akibatnya satu trace rutin membawa dua atau
tiga generasi nama atribut sekaligus, karena aplikasi, framework, dan pustaka
instrumentasinya masing-masing dipaku di versi berbeda.

Semua ejaan berikut dibaca dan diciutkan menjadi satu bentuk kanonik:

| Kanonik | Juga diterima |
|---|---|
| `gen_ai.provider.name` | `gen_ai.system`, `llm.vendor`, `llm.system` |
| `gen_ai.usage.input_tokens` | `…prompt_tokens`, `llm.usage.prompt_tokens`, `llm.token_count.prompt` |
| `gen_ai.usage.output_tokens` | `…completion_tokens`, `llm.usage.completion_tokens` |
| `gen_ai.request.model` | `gen_ai.response.model`, `llm.request.model`, `llm.model_name` |
| `gen_ai.agent.name` | `gen_ai.agent.id`, `agent.name`, `traceloop.entity.name`, resource `service.name` |

Bila ejaan lama dan baru hadir bersamaan, **yang lebih baru menang**.

## Pemetaan span

| Operasi GenAI | Event Hermes |
|---|---|
| `create_agent` | `agent_spawned` |
| `invoke_agent` | `agent_spawned` + `agent_finished` |
| `execute_tool` | `tool_call` + `tool_done` |
| `chat`, `text_completion`, `generate_content`, `embeddings` | pasangan `tool_call`/`tool_done`, tool = `llm:<model>` |
| `invoke_workflow`, `plan`, `retrieval` | pasangan `tool_call`/`tool_done` |
| span MCP (`mcp.method.name`) | `mcp_call` |
| selain itu | **diabaikan** |

Span non-GenAI tidak menghasilkan apa pun. Span HTTP atau database tidak
ditebak-tebak menjadi aksi agen palsu.

Karena OTLP mengirim span yang **sudah selesai**, operasi yang dianimasikan
kantor sebagai mulai→selesai memancarkan sepasang event yang membawa stempel
waktu asli dari span. Ring buffer terurut waktu, jadi UI memutarnya dengan
urutan benar meski tiba dalam satu batch.

## Auto-spawn

Instrumentasi nyata jarang memancarkan `create_agent` — mayoritas hanya
mengirim `chat` dan `execute_tool`. Tanpa penanganan, karakternya tidak akan
pernah muncul di lantai. Kini saat sebuah nama agen terlihat pertama kali,
server menyintesis `agent_spawned` (ditandai `synthetic: true`), mendaftarkannya
ke watchdog liveness, dan memasukkannya ke `GET /roster` agar tetap tampil
setelah halaman dimuat ulang.

## Atribusi biaya

`tool_done`, `agent_finished`, dan `mcp_call` kini membawa `inputTokens`,
`outputTokens`, `totalTokens`, dan `costUsd`.

- Biaya yang dilaporkan provider (`gen_ai.usage.cost`) selalu menang.
- Selain itu diestimasi dari `server/pricing.js` dengan pencocokan prefiks
  terpanjang, sehingga `gpt-4o-mini-2024-07-18` tidak pernah ditagih dengan
  tarif `gpt-4`.
- Provider lokal (`ollama`, `vllm`, `llamacpp`, `lmstudio`) → `0`.
- Model tak dikenal → **tidak ada** `costUsd`, bukan angka yang salah.

Ini estimasi untuk visualisasi dan sinyal anggaran, bukan penagihan. Diskon
cached-token dan batch belum dimodelkan, jadi angkanya condong lebih tinggi.

## Privasi

Isi prompt dan completion **tidak pernah dibaca**. Hanya metadata operasi,
identitas model, dan jumlah token yang melewati batas ini — kontrak yang sama
dengan `channel_msg`: kantor menunjukkan bahwa pekerjaan terjadi, bukan apa
yang dikatakan. Ada test yang memastikan konten prompt tidak bocor ke event.

Event tetap melewati pipeline ingest standar — validasi, clamping, dan
redaktor rahasia 8 pola. OTLP bukan pintu samping yang diistimewakan.

## Pembatas

- Rate limit per-event dilewati di jalur ini (batch normal akan menabrak limit
  120/menit). Sebagai gantinya dibatasi ukuran body (`8mb`) dan jumlah event
  per batch (`2000`).
- Satu span cacat tidak pernah menggagalkan seluruh batch; ia dihitung di
  `rejectedSpans`.
- Protobuf ditolak `415` dengan pesan yang menyebutkan solusinya. Mendekodenya
  butuh runtime protobuf demi format yang semua SDK sudah bisa kirim sebagai
  JSON — tidak sepadan dengan tambahan permukaan serangan.

## Verifikasi

Diuji dengan **SDK OpenTelemetry resmi v2.11.0**, bukan fixture buatan sendiri —
intinya membuktikan server menerima apa yang benar-benar dikirim SDK ke kabel:

```
probe: 6 spans exported via the official OTLP exporter
[otlp] spans=6 events=9 accepted=9 rejected=0 dropped=0
```

Hasilnya, tiga agen muncul di roster tanpa satu baris pun instrumentasi khusus
Hermes: `research-crew`, `researcher`, `planner`. Span `GET /healthz` diabaikan
dengan benar. Atribut generasi lama (`gen_ai.system` + `prompt_tokens`)
ternormalisasi ke `provider=openai`, `inputTokens=5000`.

```
node --test tests/     50/50 lulus, keluar 3,6 dtk
```

28 test baru: 22 di `tests/otlp.test.js` (decoding primitif, presisi nanodetik
19 digit, tiga generasi atribut, pemetaan span, kebocoran konten, batas batch,
tarif harga) dan 6 di `tests/integration.test.js` (auth, bentuk respons OTLP,
atribusi biaya end-to-end, auto-spawn, penolakan protobuf, span non-GenAI).

## Berkas baru

`server/otlp.js`, `server/pricing.js`, `tests/otlp.test.js`, `docs/OTLP.md`.

---

# Fase 2 — Burn-Rate Governance

Data biaya sudah mengalir sejak Fase 1. Fase ini mengubahnya dari *angka yang
dilaporkan* menjadi *batas yang ditegakkan* — lalu merendernya sebagai fisika
ruangan.

Dokumentasi lengkap: `docs/BURN-RATE.md`.

## Mengapa penegakan, bukan grafik lagi

Observability melapor setelah fakta. Saat grafik menunjukkan loop liar, uangnya
sudah habis — ada insiden 2026 terdokumentasi yang membakar puluhan ribu dolar
dalam satu akhir pekan sebelum ada yang melihat.

- IDC (Des 2025): **96% perusahaan melampaui proyeksi biaya AI**, hanya **44%**
  yang punya pagar finansial apa pun.
- **Tidak ada framework agen besar yang menyertakan batas dolar bawaan.**
- OWASP mencatatnya sebagai **LLM10 — Unbounded Consumption / "Denial of Wallet"**.

Maka anggaran harus bisa dijawab **di jalur permintaan**, dalam mikrodetik,
dari memori. Itulah `POST /budget/check`.

## Menyetir, bukan menghentikan

Riset TokenOps Microsoft menemukan tata kelola tingkat-run yang **menyetir** —
turunkan model, pendekkan konteks, buang tool call opsional — memangkas biaya
per tugas **~78%** sekaligus menaikkan penyelesaian dari **67% ke 96%**.
Penghentian keras melakukan kebalikannya: ia "menghemat" dengan menggagalkan
pekerjaan, yang hanya memindahkan biayanya ke manusia.

| Rasio | Status | Perilaku |
|---|---|---|
| < 50% | `normal` | izinkan |
| < 75% | `warm` | izinkan, sarankan model lebih murah |
| < 90% | `hot` | izinkan model murah, **tolak premium** |
| < 100% | `critical` | batasi ke tier termurah |
| ≥ 100% | `tripped` | **tolak**, sertakan `retryAfterS` |

Tiga cakupan dievaluasi bersamaan — **yang paling ketat yang berlaku**: per-agen
per jam, global per jam, global per hari.

## Endpoint baru

- **`POST /budget/check`** — keputusan penegakan. Selalu `200`, bahkan saat
  menolak: ini jawaban kebijakan, bukan kegagalan transport. Mengembalikan
  `429`/`402` akan membuat klien HTTP yang taat aturan mengulang keputusan yang
  tidak akan berubah. Baca `allow`.
- **`GET /burn`** — snapshot global dan per-agen: belanja, batas, rasio, status,
  jumlah panggilan dan token, plus kebijakan aktif.

`estimatedUsd` penting: biaya proyeksi panggilan **ini** ikut dihitung, jadi
pemanggil dihentikan **tepat di** batas, bukan satu panggilan setelahnya.

## Akuntansi

Setiap event yang membawa `costUsd` memberi makan tracker — span OTLP maupun
event bridge Hermes. Jendela waktu memakai ring buffer resolusi tetap (60 bucket
per jam, 96 per hari), jadi **memori terbatas berapa pun volume trafiknya**;
tidak ada daftar transaksi yang tumbuh. Ada test yang menjalankan 20.000
transaksi dan memastikan strukturnya tetap 60 dan 96 slot.

## Event `budget_state`

Perlintasan ambang disiarkan sebagai event, jadi kantor bereaksi langsung tanpa
polling. Hanya **transisi** yang dipancarkan, bukan setiap transaksi.

`budget_state` bersifat **internal-only**. Bridge yang mencoba mem-POST-nya ke
`/event` mendapat `400 … is internal-only`. Status anggaran otoritatif di sisi
server: bridge yang disusupi tidak boleh bisa memalsukan "aman" atau memutus
breaker agen lain.

## Lapisan fisika

`BurnOverlay.tsx` membaca `GET /burn` dan merender status sebagai suhu ruangan.
Angka di dasbor mudah diabaikan; ruangan yang terbakar tidak.

| Status | Visual |
|---|---|
| `normal` | tidak ada |
| `warm` | semburat kuning tipis |
| `hot` | semburat oranye, denyut lambat |
| `critical` | semburat merah, denyut cepat, **api menjilat dari lantai** |
| `tripped` | guyuran biru, **sprinkler menyala** |

HUD di sudut menampilkan belanja terhadap batas per jam, dan melebar saat
diklik untuk rincian per agen. `prefers-reduced-motion` mematikan seluruh
animasi dan menyembunyikan sprinkler — kontrak aksesibilitas yang sama dengan
bagian kantor lainnya. Overlay tidak merender apa pun bila anggaran tidak diset.

## Dua bug nyata yang tertangkap saat pengerjaan

**1. Pencocokan substring membalik seluruh kebijakan.** Daftar model premium
awalnya memakai `includes()`. Tapi `"gpt-4o-mini".includes("gpt-4o")` bernilai
`true` — jadi model fallback termurah justru ikut diblokir, persis membalikkan
mekanisme yang sedang dibangun. Test menangkapnya. Kini memakai regex dengan
negative lookahead, dengan test yang memaku 25 id model. Masalah yang sama sudah
saya pecahkan di `pricing.js` dan tetap terulang di sini.

**2. Bug laten yang saya perkenalkan sendiri di Fase 0.** Saat saya mengalihkan
`emitInternal` melewati `bus.ingest()`, saya tidak sadar `validateEvent` menolak
tipe internal-only. Belum meledak hanya karena `emitChatEvent` ternyata tidak
pernah dipanggil — tapi `budget_state` akan langsung menabraknya. `ingest()` kini
menerima flag `internal` yang melonggarkan **hanya** gerbang internal-only;
validasi skema, clamping, dan redaksi tetap berlaku penuh. `office_chat` juga
ditambahkan ke `KNOWN_EVENT_TYPES` — tanpa itu `emitInternal` tidak akan pernah
bisa memancarkannya, yang jelas bukan maksud penulis aslinya.

## Verifikasi

```
node --test tests/     73/73 lulus, keluar 3,9 dtk
```

23 test baru: 18 di `tests/burnrate.test.js` (tangga status, akuntansi, peluruhan
jendela, event transisi, lima tingkat keputusan, lookahead biaya, cakupan paling
ketat menang, override per-agen, batas memori, tiering model) dan 5 di
`tests/integration.test.js` (auth, penolakan guest, bridge tidak bisa memalsukan
`budget_state`, dan satu uji end-to-end penuh).

Uji end-to-end langsung pada server berjalan, anggaran global $0,50/jam:

```
GLOBAL  critical  $0.468 / $0.50  (94%)
  burner      critical  $0.279 / $0.30
  planner     warm      $0.156 / $0.30
  researcher  normal    $0.033 / $0.30

claude-opus-4    allow=False throttle  → premium models are blocked  [pakai claude-sonnet-4-5]
gpt-4o-mini      allow=True  throttle  → use the cheapest viable model
```

Persis perilaku yang diinginkan: pekerjaan **berlanjut** di tier murah sementara
model mahal diblokir.

Test eventbus lama (`validates every known event type with golden payload`) ikut
pecah karena penambahan tipe event — itu memang tugasnya. Diperbarui agar
eksplisit menyatakan tipe mana yang internal-only, dan kini juga menegaskan tipe
tersebut **ditolak** dari jalur eksternal.

## Berkas baru

`server/burnrate.js`, `frontend/src/components/BurnOverlay.tsx`,
`tests/burnrate.test.js`, `docs/BURN-RATE.md`.

---

# Fase 3 — Policy as Floor Plan

Ini paritnya. Setiap produk tata kelola agen menuliskan kebijakan sebagai YAML
yang tak pernah dibaca siapa pun. Hermes Office sudah menggambar sebuah gedung
— maka gambarnya yang dijadikan otoritatif.

```
ruangan                      = zona kepercayaan (alat & model apa yang terjangkau)
anggaran ruangan             = amplop belanja   (ruangan kecil tak bisa membakar banyak)
pintu                        = gerbang kebijakan (sebagian transisi butuh manusia)
memindahkan agen ke ruangan  = memberikan scope
```

Hasilnya bisa diaudit oleh orang non-teknis. *"Kenapa agen itu boleh menjalankan
kubectl?"* menjadi *"karena seseorang menaruhnya di server room — ini siapa yang
melakukannya, dan kapan."*

Dokumentasi lengkap: `docs/POLICY.md`.

## Deny by default

Ruangan tak dikenal, agen belum ditugaskan, atau alat yang tak cocok dengan pola
mana pun — semuanya mendarat di ruangan default, yaitu zona dengan hak paling
rendah. Kebijakan yang gagal-terbuka bukan kebijakan.

## Denah bawaan

| Ruangan | Trust | Alat | Model maks | Anggaran/jam | Gerbang |
|---|---|---|---|---|---|
| `lobby` | untrusted | `web_search`, `read_file`, `fetch`, `llm:*` | cheap | $0,25 | — |
| `main-office` | standard | `*` minus shell/deploy/infra | premium | $2,00 | — |
| `meeting-room` | standard | sama | premium | $1,00 | — |
| `ceo-office` | standard | `*` minus shell/deploy/infra | premium | $10,00 | masuk |
| `mac-studio` | privileged | `*` minus terraform | premium | $3,00 | masuk, `deploy` `bash` |
| `server-room` | privileged | `*` | premium | $5,00 | masuk, `deploy` `kubectl` `terraform` `psql` `bash` |
| `kitchen`, `nap-room` | idle | tidak ada | — | $0 | — |

Bisa ditimpa lewat `OFFICE_POLICY_FILE`. Berkas rusak atau tak terbaca memicu
peringatan dan jatuh ke default — server tidak pernah boot tanpa kebijakan.

## Endpoint baru

- **`POST /policy/check`** — gerbang terpadu. Kebijakan ruangan dulu (*boleh
  tidak di sini?*), lalu belanja (*mampu tidak?*). Menggantikan `/budget/check`,
  yang tetap ada untuk pemanggil yang hanya peduli uang.
- **`GET /policy`** — denah sebagai data. Inilah artefak auditnya, bukan YAML.
- **`POST /agents/:agent/room`** — memindahkan agen. **Owner saja**, karena
  memindahkan *adalah* memberi scope. `202` bila ruangan butuh tanda tangan.
- **`GET /approvals`**, **`GET /approvals/:id`**, **`POST /approvals/:id`** —
  antrean pintu. Membaca antrean tidak istimewa; **memutuskan** iya.

Penolakan bersifat **bisa ditindaklanjuti**: `hint` menyebutkan di ruangan mana
alat itu akan diizinkan, dan apakah butuh tanda tangan di sana.

```
lobby    allow=false deny    deploy is outside the scope of Lobby
                      ↳ allowed in: Server Room (with sign-off), Mac Studio (with sign-off)
```

## Dua gerbang yang terpisah

Masuk ke ruangan istimewa dan memakai alat berbahaya di dalamnya adalah dua
pemberian izin yang berbeda. Agen yang sudah disetujui masuk server room tetap
butuh tanda tangan untuk `deploy`. Token persetujuan terikat pada pasangan
`(agen, alat)` dan tidak bisa diputar ulang untuk agen lain atau alat lain —
keduanya ada testnya.

## Event tata kelola

`agent_moved`, `approval_requested`, `approval_resolved` disiarkan agar kantor
bereaksi langsung. Ketiganya **internal-only**: bridge yang mem-POST-nya ke
`/event` mendapat `400 … is internal-only`. Bridge yang disusupi tidak boleh
bisa memindahkan dirinya ke server room atau menyetujui dirinya sendiri.

## UI

`ApprovalGate.tsx` merender antrean sebagai panel yang secara visual menghalangi
lantai, lengkap dengan pendar pintu diketuk dan hitung mundur kedaluwarsa. Owner
mendapat tombol approve/deny; yang lain melihat "owner decision required".
`prefers-reduced-motion` mematikan animasinya.

## Dua temuan saat pengerjaan

**1. Test saya sendiri yang salah, dan itu membuktikan desainnya benar.** Satu
test memindahkan agen ke `ceo-office` lalu menegaskan anggaran per-agen berlaku.
Test-nya gagal — ternyata `ceo-office` butuh persetujuan masuk, jadi agennya tak
pernah benar-benar pindah dan tetap tertahan di lobby. Gerbangnya bekerja persis
seperti seharusnya; saya yang lupa. Test diperbaiki agar menyetujui dulu, dan
kini menegaskan `roomFor` secara eksplisit sebelum melanjutkan.

**2. Urutan evaluasi mengubah kualitas pesan.** Dapur punya `tools.allow: []`
dan anggaran `0`. Awalnya penolakan datang dari gerbang alat: *"write_file is
outside the scope of Kitchen"* — benar, tapi tidak informatif. Pemeriksaan
anggaran-nol dipindah ke paling depan sehingga jawabannya menjadi *"Kitchen has
no spend allowance (agents here are idle)"*, yang menjelaskan jauh lebih banyak
kepada operator.

## Verifikasi

```
node --test tests/     108/108 lulus, keluar 4,1 dtk
```

35 test baru: 24 di `tests/policy.test.js` (pencocokan glob, tiering model,
fallback kebijakan rusak, deny-by-default, ruangan tak dikenal tidak gagal-buka,
hint penolakan, deny-list mengalahkan allow-list, perpindahan mengubah izin,
pencatatan pemberi izin, plafon tier model, ruangan idle, gerbang pintu,
persetujuan ditolak/kedaluwarsa/ganda, anti-replay, batas memori, amplop
belanja ruangan, interaksi dengan anggaran agen, snapshot) dan 11 di
`tests/integration.test.js` (auth tiap endpoint, 202 di pintu, bridge tidak bisa
memutuskan, dua gerbang berurutan, anti-replay lintas alat, 409 resolusi ganda,
bridge tidak bisa memalsukan event tata kelola, 404 untuk id palsu).

Rantai penuh terverifikasi pada server berjalan:

```
1) agen baru          → lobby      deny deploy  ↳ allowed in: Server Room (with sign-off)
2) dipindah ke main-office         deny deploy  (ada di deny-list)
3) minta server-room               202, tertahan di pintu
4) manusia menyetujui              → server-room, tapi deploy masih await_approval
5) gerbang kedua disetujui         → allow
```

## Berkas baru

`server/policy.js`, `frontend/src/components/ApprovalGate.tsx`,
`tests/policy.test.js`, `docs/POLICY.md`.

---

## Audit Pra-Fase 4 — perbaikan regresi & utang (Okt 2026)

Dilakukan sebelum memulai Flight Recorder, atas pertanyaan "masih ada yang
perlu diselesaikan?". Jawabannya: ya, dan satu di antaranya serius.

### P0 — Kebocoran guest pada permukaan tata kelola *(regresi yang saya buat sendiri)*

v1 sangat berhati-hati soal apa yang boleh dilihat guest (`sanitizeForGuest`,
`/roster` terfilter). Lima endpoint baca Fase 2–3 dikirim dengan `requireAny`
dan **membatalkan kontrak itu**. Diverifikasi langsung dengan token guest:

| Endpoint | Yang bocor sebelum perbaikan |
|---|---|
| `GET /burn` | `spentHourUsd`, `limitHourUsd`, `lifetimeUsd` — pengeluaran AI bisnis ini |
| `GET /policy` | daftar tool server-room lengkap, tool yang digerbangi, anggaran tiap ruang |
| `GET /approvals` | nama agen + ruang + alasan permintaan privilese |

Lebih buruk: `sanitizeForGuest` hanya mengenali `git_push`, `a2a_task_*`,
`office_chat`, `service_status`. Empat tipe event baru — `budget_state`,
`agent_moved`, `approval_requested`, `approval_resolved` — **lolos mentah ke
WebSocket guest**. Jadi meredaksi REST saja tidak akan cukup.

Perbaikan: guest kini menerima **suhu tanpa nominal** dan **denah tanpa peta
privilese**. Ruang masih bisa terlihat terbakar; angkanya tidak ikut.
`GET /approvals/:id` diturunkan ke `bridge|owner` (403 untuk guest) karena
tampilan detail akan membuka kembali persis yang diredaksi daftar.

Dijaga **5 test regresi** baru, salah satunya memverifikasi jalur WebSocket —
karena pelanggaran pertama justru akan lolos bila hanya REST yang diuji.
Satu test lama yang *menuntut* perilaku bocor ikut diperbaiki.

### P1 — UI menjanjikan wewenang yang tidak dimiliki
`ApprovalGate` di-mount dengan `canApprove` selalu `true`: guest melihat tombol
*approve*/*deny* yang dijamin 403. Kini peran disimpulkan dari penanda
`redacted` pada payload (tanpa permintaan kedua), dan `BurnOverlay`
menyembunyikan baris nominal bila payload-nya diredaksi.

### P2 — Dokumen yang menjadi bohong
`SECURITY.md` §3 sudah mensyaratkan *"unit test wajib untuk tiap event type"* —
aturan yang dilanggar perbaikan ini. Kini §3 memuat tabel redaksi per event dan
per endpoint, plus §9b yang mencatat regresi ini apa adanya. `EVENTS.md` dapat
§3b untuk empat tipe internal baru. `README.md` dapat tabel endpoint v2 dan
tautan ke tiga dokumen Fase 1–3 yang sebelumnya tidak terdaftar.

### P3 — Utang Fase 0 yang ditutup
- **Linter** (sebelumnya tidak ada sama sekali). ESLint 9 flat config, dipilih
  untuk menangkap kelas bug yang proyek ini benar-benar kena — bukan gaya
  penulisan. Membersihkan 18 temuan nyata: `randomUUID` tak terpakai, variabel
  loop mati, `await` redundan, nilai balik di dalam promise executor.
  *Catatan:* bug cocok-substring model (`gpt-4o-mini` mengandung `gpt-4o`)
  tertulis **dua kali** di proyek ini; itulah alasan linter ada.
- **CI benar-benar dibuat.** `CHANGELOG` Fase 0 menjelaskan perbaikan pada
  `.github/workflows/`, tetapi direktori itu tidak ada di ZIP pertama, jadi
  saat audit saya simpulkan klaim itu menggambarkan berkas yang tidak ada.
  **Koreksi (lihat bagian Sinkronisasi di bawah): berkasnya nyata, hanya tidak
  ikut terbawa ZIP pertama.** ZIP kedua memuatnya, dan isinya persis seperti
  yang digambarkan Fase 0 — `npm ci || npm install`, `node --test tests/ || true`,
  `node --check` atas 3 berkas saja. Jadi diagnosisnya benar; yang keliru hanya
  kesimpulan audit bahwa berkasnya fiktif. Versi di fork ini tetap dipakai
  karena merupakan superset: tiga job (server/frontend/assets), `npm run lint`
  sebagai gerbang, `timeout-minutes`, `check-shutdown.sh`, dan pemeriksa bahwa
  setiap path sprite yang dirujuk kode ada di disk.

### Masih terbuka (sadar, tidak mendesak)
Tidak ada rate limit pada `/policy/check` meski ia ada di jalur panas setiap
permintaan agen; `bridges/hermes-cloud-plugin/` masih yatim; `RateLimiter.hits`
tidak pernah dievict; 14 IP Tailscale ter-hardcode di 8 berkas; belum ada test
frontend sama sekali.

**Verifikasi:** 113 test lulus · lint bersih · build frontend bersih ·
`check-shutdown.sh` PASS · kebocoran diuji ulang terhadap server hidup dengan
token guest sungguhan.


---

# Fase 4 — Flight Recorder & Compliance Dossier

Pilar C dari strategi. Fase 1–3 membangun jalur keputusan; tidak satu pun
**tercatat** dalam bentuk yang bisa dipertahankan di hadapan auditor. Ring
buffer menyimpan 7 hari di RAM dan hilang saat restart — itu monitoring, bukan
jejak audit.

Kewajiban sistem AI berisiko tinggi di EU AI Act berlaku sejak 2 Agustus 2026:
Art. 12(1) pencatatan otomatis (manual eksplisit tidak memenuhi syarat),
Art. 14 pengawasan manusia, Art. 19 retensi ≥ 6 bulan, Art. 99(4) denda hingga
€15 jt atau 3% omzet global.

### Yang dibangun

**`server/ledger.js`** — ledger append-only ber-rantai SHA-256 di SQLite
terpisah (`ledger.db`, bukan `office.db`: beda aturan retensi, beda aturan
akses, dan bisa diarsipkan tanpa ikut membawa riwayat chat).

**`server/dossier.js`** — penerjemah ledger menjadi dokumen naratif. Keluhan
praktisi yang berulang bukan "log-nya tidak ada", melainkan "yang ada adalah
JSON mentah dan yang harus menandatangani bukan insinyur".

**`frontend/src/components/AuditBadge.tsx`** — indikator integritas rantai,
tombol verify, dan ekspor dosir. Tidak dirender sama sekali untuk guest —
bukan ditampilkan dalam keadaan nonaktif. Review Fase 3 menandai pola "tombol
yang dijamin 403" sebagai cacat; mengulanginya akan konyol.

### Keputusan desain yang layak dicatat

**Posisi ikut di-hash, bukan hanya isi.** Kalau tidak, dua keputusan identik
akan berhash sama dan bisa ditukar tanpa terdeteksi.

**Canonical JSON ditulis sendiri, bukan `JSON.stringify`.** Rantai hanya
sehandal serialisasinya: bila dua proses bisa men-serialisasi rekaman logis
yang sama secara berbeda, verifikasi gagal pada data jujur — dan alarm palsu
dalam audit hampir sama merusaknya dengan kebocoran yang terlewat. Kunci
diurutkan, siklus melempar error alih-alih memotong diam-diam.

**Verifikasi melaporkan putus pertama saja.** Setelah satu mata rantai rusak,
semua sesudahnya tidak terverifikasi; menampilkan ribuan kegagalan turunan
hanya akan mengubur suntingan yang sebenarnya.

**Isi prompt/completion tidak pernah masuk ledger.** Tidak diperlukan untuk
merekonstruksi keputusan, dan justru bagian paling mungkin membawa data
pribadi — yang akan menyeret dosirnya sendiri ke ranah GDPR.

**Owner-only, termasuk tertutup untuk bridge.** Token bridge dipegang setiap
proses agen, dan agen adalah **subjek** catatan ini. Ekspor dosir dicatat ke
ledger itu sendiri.

**Kegagalan tulis tidak menolak aksi.** Kantor yang berhenti mengatur saat
diska penuh lebih buruk daripada yang punya celah di lognya — dan celahnya
terlihat, karena nomor seq berurutan.

### Dua celah nyata yang ditemukan saat membangun

1. **Kedaluwarsa persetujuan tidak menerbitkan event apa pun.** Ledger akan
   mencatat permintaan tanpa hasil. Padahal "tidak ada yang menjawab, jadi
   aksinya tidak terjadi" adalah bukti positif bahwa sistem *fail closed* —
   persis yang diminta Art. 14. Kini diterbitkan seperti resolusi lainnya,
   lengkap dengan `waitedMs`.

2. **Injeksi Markdown lewat nama agen.** Nama agen sampai ke ledger lewat span
   OTLP, artinya dipengaruhi penyerang. Nama seperti `` evil`\n\n## Heading ``
   bisa memalsukan struktur di dokumen yang justru dibaca sebagai bukti.
   Ditemukan oleh test yang ditulis untuk tabel, lalu ternyata berlaku di
   seluruh dokumen. Semua nilai kini lewat `safe()`; nilainya tetap dilaporkan,
   hanya dinetralkan — meredaksi akan lebih buruk, auditor perlu tahu siapa
   yang bertindak.

### Batas yang dinyatakan, bukan disembunyikan

Rantai hash bersifat **tamper-evident, bukan tamper-proof**:

| Serangan | Terdeteksi? |
|---|---|
| Ubah isi / timestamp di tempat | ✅ menyebut seq persisnya |
| Hapus dari tengah | ✅ `broken-link` |
| Ubah isi **dan** hitung ulang hash-nya | ✅ rekaman berikutnya terikat hash lama |
| Hapus dari **ekor** | ❌ rantai pendek tetap konsisten |
| Tulis ulang seluruh berkas | ❌ |

Dua baris terakhir hanya tertutup dengan menjangkarkan `GET /ledger/head` di
luar sistem. Ada satu test yang **sengaja menegaskan keterbatasan ini**
(`LIMITATION: tail truncation is NOT detected`) supaya klaimnya tidak diam-diam
menggelembung seiring waktu. Dosirnya sendiri mencetak peringatan yang sama di
halaman pertama — bukan di lampiran.

### Juga di fase ini (sisa P3 dari audit)

- **Rate limit `/policy/check`** — 600/menit per agen, **fail closed**.
  Endpoint ini ada di depan setiap aksi agen, jadi ia sekaligus yang tersibuk
  dan yang akan dihantam agen yang terjebak retry loop: persis bentuk OWASP
  LLM10 *denial of wallet* yang fitur ini ada untuk mencegahnya. Di-key per
  agen supaya satu agen nakal tidak mengunci yang lain.
- **`RateLimiter.hits` kini di-evict.** Tanpa itu ia kebocoran tak terbatas:
  setiap nama agen yang pernah terlihat menyimpan entri selamanya, dan nama
  agen dipengaruhi penyerang lewat jalur OTLP. Disapu dari `check()`, bukan
  dari timer, supaya limiter tidak memegang handle yang menahan proses saat
  shutdown.

### Performa (terukur)

| `synchronous` | per rekaman | keputusan/dtk |
|---|---|---|
| `FULL` | 0,020 ms | ~49.000 |
| `NORMAL` | 0,019 ms | ~52.000 |
| `OFF` | 0,018 ms | ~57.000 |

Durabilitas penuh praktis gratis **di sandbox ini** — dengan catatan kontainer
sering punya `fsync` jauh lebih murah daripada diska jaringan sungguhan.
Skala 100.000 rekaman: tulis 2,1 dtk · verify 0,7 dtk · 31,3 MB.
Ekstrapolasi ~1,1 GB/tahun pada 10.000 keputusan/hari.

### Verifikasi

**148 test lulus** (`ledger.test.js` 27 baru, `integration.test.js` +8) ·
lint bersih · build frontend bersih · `check-shutdown.sh` PASS ·
diuji ujung-ke-ujung terhadap server hidup: guest dan bridge → 403 di keempat
endpoint audit, rantai verify `ok` setelah lalu lintas nyata.


---

## Sinkronisasi dengan upstream — `hermes-office-main-2.zip` (5 Okt 2026)

ZIP kedua dibandingkan berkas-per-berkas dengan ZIP pertama. Selisih total
kedua arsip hanya **3.125 byte dari 90 MB (0,003%)**, yang langsung
mengesampingkan dugaan awal bahwa ada 55 MB seni baru — perbedaan direktori
aset ternyata berasal dari pemangkasan salinan ZIP1 di workspace ini, bukan
dari perubahan upstream.

### Yang benar-benar berubah di upstream

**1. Auto-guest — dampak keamanan terbesar.** `GET /` kini menerbitkan session
guest read-only untuk browser tanpa token. Dipasang di fork ini apa adanya.

Konsekuensinya mengubah taruhan audit pra-Fase 4 secara fundamental: server
dipublikasikan lewat Tailscale Funnel, jadi **"pengunjung anonim di internet
publik" dan "guest" sekarang principal yang sama**. Kebocoran yang ditemukan
audit kemarin — `/burn`, `/policy`, `/approvals` menyajikan pengeluaran per jam
dan peta privilese lengkap ke token guest — dengan auto-guest aktif berarti
**terbaca siapa pun di internet, tanpa kredensial apa pun**. Perbaikan itu
berhenti menjadi defence-in-depth dan menjadi satu-satunya batas.

Ditambahkan **4 test** yang menegaskannya dari sudut pandang browser anonim
sungguhan (ambil cookie dari `GET /`, lalu pakai cookie itu): permukaan audit
403, angka belanja nol, tidak ada `kubectl`/`terraform` di mana pun, dan
session owner yang sudah ada **tidak pernah diturunkan** menjadi guest.

**2. `agent_status.agent` boleh string atau objek `{name, id, role}`.**
Upstream memperbaiki Map presence yang mengunci dengan objek mentah sehingga
setiap agen runtuh jadi `[object Object]`. Fork ini ternyata punya bug
**kebalikannya**: ia mensyaratkan `typeof === "string"` dan karena itu membuang
heartbeat bentuk-objek **diam-diam** — termasuk setiap `agent_spawned`, yang
`agent`-nya objek menurut skema. Keduanya salah; kini dinormalkan ke
`id ?? name` di server, `OfficeStage.tsx`, dan `AgentsPanel.tsx`. Satu test
baru menjaga agar `[object Object]` tidak pernah muncul sebagai key.

**3. `AgentsPanel.tsx` seed presence dari `GET /presence` saat mount.** WS
tidak me-replay history, jadi tanpa ini agen yang sudah heartbeating sebelum
halaman dibuka tampil `away` sampai heartbeat berikutnya. Diambil utuh — fork
ini tidak pernah menyentuh berkas tersebut.

**4. Dokumentasi**: kontrak `agent` string-atau-objek (`EVENTS.md`), gotcha
presence & auth era dual-space (`DEPLOYMENT.md §10.1`), status mac-relay
terpasang. Digabungkan ke versi fork, bukan menimpanya.

### Cacat di pekerjaan fork ini yang ikut ketahuan

**Konversi WebP Fase 0 menjatuhkan dua berkas tanpa suara**:
`rooms/office-day-dm.png` dan `rooms/office-night-dm.png` (3,1 MB). Keduanya
tidak dirujuk kode mana pun sehingga tidak ada yang rusak saat runtime, tetapi
itu tetap kehilangan data yang tidak dilaporkan. Dipulihkan sebagai WebP
dengan parameter pipeline yang sama (86 kB dan 80 kB). Audit ulang
berkas-per-berkas kini bersih: **tidak ada satu pun aset upstream yang hilang
dari fork**.

Pemeriksaan silang juga memastikan 108 sprite karakter hasil konversi
**identik piksel-demi-piksel** dengan PNG upstream (selisih 0,0 termasuk kanal
alpha), dan `server-room-day` hanya berbeda 0,9/255 — murni artefak kompresi.

### Tidak ada konflik pada Fase 1–4

Tidak satu pun perubahan upstream menyentuh `otlp.js`, `burnrate.js`,
`policy.js`, `ledger.js`, `dossier.js`, atau kontrak event baru. Satu-satunya
titik temu adalah `server/index.js` (dua sisipan, keduanya di luar blok
Fase 1–4) dan `OfficeStage.tsx`, yang disisipi secara bedah agar
`BurnOverlay` / `ApprovalGate` / `AuditBadge` tetap terpasang.

**Verifikasi:** 154 test lulus · lint bersih · build frontend bersih ·
`check-shutdown.sh` PASS · tidak ada aset upstream yang hilang.


---

# Fase 5 — Tema Donghua 3D (6 Okt 2026)

Pergantian arah visual: dari pixel-art isometrik datar menjadi **3D-CG bergaya
donghua** — bahasa visual serial animasi Tiongkok kelas atas. Konsep awalnya
bukan 3D, jadi yang diadaptasi adalah *kesan* 3D, bukan geometrinya.

## Keputusan arsitektur: pre-render, bukan runtime 3D

Tiga jalur dipertimbangkan. Yang dipilih adalah **aset pre-render + satu
lapisan atmosfer WebGL**, dengan alasan yang bisa diukur:

| Jalur | Biaya bundle | React | Risiko |
|---|---|---|---|
| Pre-render + shader atmosfer | **+7,8 kB** | tetap 18 | rendah |
| Hybrid kamera 3D + billboard | ~+250 kB | wajib 19 + R3F 9 | menengah |
| Full real-time 3D (model GLB) | ~+250 kB + aset | wajib 19 | tinggi |

R3F v9 hanya berpasangan dengan React 19 sementara repo ini React 18.3.1, jadi
dua jalur terakhir menuntut upgrade mayor yang menyentuh 15 komponen. Lebih
menentukan lagi: yang menjual kesan "3D" pada donghua bukan geometri melainkan
**cahaya** — rim light, poros cahaya volumetrik, debu yang melayang. Itu semua
fenomena per-frame yang tetap bisa dijalankan di atas pelat statis. Bundle naik
209 → 217 kB.

## Kendala yang menentukan cara kerja

Latar ruangan adalah **cangkang kosong**; furnitur ditempel di atasnya pada
koordinat persen — `main-office` sendiri punya 42 furnitur dan 18 titik berdiri.
Membuat latar baru dari nol akan menggeser setiap koordinat itu. Karena itu
pelat yang sudah punya seni **di-restyle dari gambar aslinya**, dan pelat yang
baru dibuat memakai `office-day` sebagai **pengunci kamera**. Verifikasi grid
memastikan lantai, water cooler, pintu, whiteboard dan bench mendarat di posisi
yang sama.

## 8 ruangan baru benar-benar ada

Audit menemukan **8 dari 14 pelat adalah PLACEHOLDER Fase 0** — persegi warna
polos bertuliskan nama ruangan, tanpa seni sama sekali: `ceo-office`,
`lobby-reception`, `meeting-room`, `kitchen-cafeteria`, `gym-fitness-room`,
`nap-wellness-room`, `rooftop-terrace`, `parking-garage`. Kedelapannya kini
punya seni sungguhan. Ini sekaligus melunasi salah satu dari dua keputusan
desain yang tertunda sejak Fase 0.

Pemeriksaan statistik (`stddev` per pelat) dipakai sebagai bukti: setiap pelat
kini di atas 34, sementara placeholder berada di bawah 12. **Nol placeholder
tersisa.**

Satu penilaian saya keliru di tengah jalan dan layak dicatat: `server-room`
sempat dianggap gagal karena hasilnya tampak-depan datar, bukan isometrik.
Setelah sumbernya diperiksa, ternyata pelat aslinya memang tampak-depan datar —
restyle-nya justru benar. Hasil yang baik nyaris dibuang karena asumsi.

## Karakter: filter deterministik, bukan generate ulang

`scripts/stylize-donghua.py` memberi 249 sprite lapisan rim light, ambient
occlusion, specular, gradasi hangat dan keyline.

Alasan memilih filter dan bukan image-gen bersifat teknis, bukan selera: ada
27 tokoh × 4 arah hadap. Image-gen tidak mampu menjaga satu identitas stabil
di empat sudut sebanyak 27 kali, dan **wajah yang berubah saat tokoh berbalik
jauh lebih mengganggu daripada sprite yang kurang ornate**. Filter memberi
konsistensi sempurna antar arah hadap secara gratis.

Dua detail yang menentukan hasil:
- Arah cahaya rim **disamakan dengan god ray di pelat ruangan**. Kalau berbeda,
  karakter langsung terlihat tertempel — justru kegagalan yang hendak dicegah.
- Setiap operasi **alpha-aware**. Tanpa itu muncul halo begitu sprite
  dikomposit di atas ruangan.

Skrip ini idempoten: selalu membaca dari `art-backup/`, jadi dijalankan
berulang tidak menumpuk efek.

## Lapisan atmosfer WebGL

`AtmosphereLayer.tsx` — satu fragment shader fullscreen, tanpa Three.js. God
ray volumetrik searah pencahayaan pelat, debu di **tiga bidang parallax** (satu
bidang saja terbaca sebagai kotoran lensa), vignette, gradasi sinematik.

Yang membuatnya bukan hiasan: shader membaca **burn state Fase 2**, sehingga
kantor berubah suhu seiring belanja naik — sian tenang → amber → oranye → merah
→ biru dingin saat tripped. Lapisan tata kelola dan arah seni menjadi satu hal
yang sama.

Pertahanan yang dipasang: cap DPR 1,5 (lapisan lembut, resolusi retina penuh
tidak menambah apa pun tapi memakan baterai), berhenti saat tab tersembunyi,
pemulihan `webglcontextlost`, dan **render kosong bila WebGL2 tidak ada** —
ruangan tetap tampil baik tanpa udaranya, dan itulah gunanya memisah lapisan.
`prefers-reduced-motion` membekukan waktu, bukan sekadar memperlambat.

## Token OKLCH

`styles/donghua.css` memuat palet jade/emas/tinta dalam OKLCH. Alasannya nyata,
bukan ikut tren: palet ini satu keluarga hue di beberapa tingkat terang, dan di
sRGB langkah terang melenceng secara persepsi. Dengan OKLCH chrome UI tetap
terbaca di atas lobby terang maupun nap-room nyaris hitam **tanpa penyetelan
per ruangan**. File ini dimuat terakhir dan hanya mengambil alih tampilan —
2.300 baris tata letak lama tidak disentuh.

---

## Koreksi: CI yang saya klaim ada, ternyata tidak

Entri Fase 0 menyatakan CI "benar-benar dibuat" dengan tiga job. Pada
sinkronisasi upstream saya menegaskan ulang bahwa versi fork ini "merupakan
superset" dari milik upstream.

**Kedua pernyataan itu salah. `.github/` tidak pernah ada di fork ini.**

Ini bukan kehilangan snapshot — `.gitignore` dan `.npmrc` selamat di direktori
yang sama. Berkasnya memang tidak pernah dibuat, dan koreksi saya sebelumnya
justru memperkuat klaim yang keliru alih-alih memeriksanya.

Sekarang berkasnya ada dan setiap gerbangnya sudah dijalankan secara lokal.
Satu cacat nyata langsung tertangkap saat verifikasi: job `server` menjalankan
`npm test` tanpa membangun frontend, padahal satu test menyajikan SPA dari
`frontend/dist` — CI akan **merah di jalankan pertama**, dan merah yang terlihat
seperti flaky adalah jenis merah terburuk. Langkah build ditambahkan sebelum
test.

## Aset hilang, lagi — dan penyebab sistemiknya

`office-day-dm.webp` dan `office-night-dm.webp`, yang dipulihkan pada
sinkronisasi upstream, **hilang lagi**. Penyebabnya: salinan pristine ZIP2
sebesar 87 MB tidak muat dalam batas snapshot workspace, jadi baseline
pembanding ikut lenyap dan pemeriksaannya diam-diam berhenti bisa dijalankan.

Memulihkan berkasnya saja hanya mengulang siklus. Perbaikan yang sebenarnya:

- **`frontend/public/ASSET-MANIFEST.json`** — catatan 30 kB berisi path, ukuran
  dan SHA-256 dari seluruh **258** aset upstream. Bertahan di tempat arsip 90 MB
  tidak bisa.
- **`scripts/check-assets.sh`** — memverifikasi semuanya secara offline, tanpa
  jaringan dan tanpa arsip. Ekstensi sengaja diabaikan karena fork ini memang
  mengonversi PNG → WebP; mencocokkan ekstensi akan melaporkan setiap berkas
  hasil konversi sebagai hilang.
- Dipasang sebagai **gerbang CI**, bukan skrip yang bisa dilupakan.

Hasil: `PASS: all 258 upstream assets accounted for`.

**Verifikasi Fase 5:** 154 test lulus · lint bersih · parse seluruh modul bersih ·
build frontend bersih (217 kB) · shutdown PASS · 258/258 aset utuh · nol
placeholder.


---

# Fase 6 — Bisa dipasang orang lain (6 Okt 2026)

Fokus: menghapus setiap hal yang membuat repo ini hanya bisa dijalankan oleh
penulisnya. Tanpa ini harga $2.000+/bulan tidak bisa dipertahankan — produk
yang alamat IP-nya milik satu orang bukan produk, melainkan instalasi pribadi.

## Default yang diam-diam menunjuk mesin orang lain

Dua default jauh lebih berbahaya daripada sekadar tidak rapi:

**`HERMES_A2A_MAC_URL` default `http://100.120.57.37:9900`.** `chat.js:149`
mem-POST pesan ke alamat ini **tanpa syarat**. Pemasang baru yang mengetik
`@mac` akan mengirim isi chat-nya ke host yang tidak ia kendalikan dan tidak
bisa ia lihat. Sekarang defaultnya kosong dan rute itu menolak dengan 503
beserta nama variabel yang harus diisi — menolak, bukan menebak.

**`GITHUB_ORG` default `"Niumination"`.** Siapa pun yang menyetel
`GITHUB_TOKEN` tanpa `GITHUB_ORG` akan menghabiskan kuota rate limit miliknya
sendiri untuk memolling repositori orang lain. Sekarang kosong, dan poller
menolak jalan kecuali **kedua** bagian terisi, dengan log yang menyebut bagian
mana yang kurang.

Selebihnya: `mac-relay.sh` kini keluar dengan kode 2 dan instruksi bila
`OFFICE_URL` tidak diisi; 12 IP di README, ARCHITECTURE, DEPLOYMENT, PRD dan
MAC-PLAYBOOK diganti placeholder `<office-host>` / `<mac-host>`.

Boot kini melaporkan integrasi mana yang hidup (`githubPoller`, `a2aMac`,
`otlp`, `ledger`, `guestAutoSession`), karena sebelumnya "terkonfigurasi" dan
"menunjuk ke tempat yang berguna" terlihat sama dari luar.

`scripts/check-deployable.sh` memasang ini sebagai gerbang CI permanen.
Fixture test sengaja dikecualikan: sanitizer guest justru diuji untuk
membuang alamat internal, jadi melarangnya di sana akan menghapus alasan
test itu ada.

**Satu jebakan yang nyaris lolos:** fixture di `eventbus.test.js` sempat saya
ganti ke `203.0.113.10`. Test langsung gagal — dan benar gagal. `INTERNAL_IP`
menyaring berdasarkan rentang, dan `203.0.113.x` adalah alamat **publik**, jadi
sanitizer tepat tidak meredaksinya. Mengganti alamat di fixture ternyata
mengubah makna pengujiannya. Diganti ke `100.64.0.1` — basis rentang CGNAT,
tetap "internal" bagi sanitizer tapi bukan mesin siapa pun.

## Poller ganda yang saya buat sendiri

Fase 5 menambahkan poll `/burn` tiap 5 detik di `OfficeStage` untuk menyuplai
shader atmosfer. `BurnOverlay` ternyata **sudah** memolling endpoint yang sama
tiap 3 detik. Jadi ada dua poller independen ke satu endpoint dalam satu
halaman — sekitar **1.440 request/jam per tab** — untuk data yang server
**sudah push** lewat WebSocket (`burnrate.js:226` memancarkan `budget_state`
saat transisi).

Akibat kedua lebih halus: dua timer berarti HUD dan pencahayaan ruangan bisa
berselisih sampai lima detik, jadi ruangan masih tampak tenang sementara HUD
sudah menyatakan `hot`.

`useBurnState.ts` menggantinya. Polanya tidak bisa murni WS karena dua alasan
yang keduanya nyata: socket **tidak me-replay history**, jadi tab yang dibuka
setelah transisi terakhir akan menampilkan `normal` sampai transisi berikutnya
yang mungkin berjam-jam lagi; dan `budget_state` sengaja hanya membawa
`{scope, state, from, source, ts}` tanpa angka dolar, karena guest tidak boleh
menerimanya. Jadi: **seed sekali saat mount, label didorong seketika oleh
socket, dan snapshot lengkap diambil ulang hanya saat transisi benar-benar
terjadi.** Keadaan diam berbiaya nol request. Hari sibuk dengan 20 transisi
berbiaya 21.

Transisi ber-scope agen sengaja diabaikan untuk keadaan global — shader dan
HUD sama-sama mendeskripsikan ruangan secara keseluruhan.

Penggabungan ini juga memaksa satu tipe `BurnSnapshot`. Sebelumnya ada dua
definisi yang sudah menyimpang (satu menjadikan `spentDayUsd` opsional), dan
TypeScript baru melaporkannya di titik pemanggilan — tempat yang salah untuk
mengetahuinya.

## Koreksi ketiga soal CI — dan kali ini penyebabnya

Dua penjelasan sebelumnya salah. Yang pertama: berkasnya fiktif. Yang kedua:
berkasnya tidak pernah dibuat. **Keduanya keliru.**

Penyebab sebenarnya: **workspace ini tidak mempertahankan direktori-titik.**
Berkas-titik seperti `.gitignore`, `.npmrc` dan `.env.office.example` bertahan;
`.github/` tidak. Workflow itu benar-benar ditulis dan diverifikasi, lalu
direktori tempatnya menguap — dua kali.

Perbaikannya struktural, bukan menulis ulang berkasnya lagi:

- **`ci/workflow.yml`** — sumber kanonik di jalur biasa yang bertahan.
- **`scripts/install-ci.sh`** — menyalinnya ke `.github/workflows/ci.yml`.
- **`scripts/check-ci.sh`** — gagal bila yang terpasang hilang atau menyimpang,
  dan dijalankan **oleh CI itu sendiri**. Definisi CI yang tidak diverifikasi
  apa pun adalah definisi yang menyimpang — persis bagaimana repo ini sampai
  mengklaim secara tertulis, dua kali, memiliki workflow yang tidak ada.

Skrip dipanggil lewat `bash scripts/...` dan bukan `./scripts/...`, karena bit
executable juga tidak bertahan di setiap checkout dan kehilangannya terbaca
seperti skrip yang hilang.

## Lain-lain

`bridges/hermes-cloud-plugin/` dihapus — hanya berisi `HOOK.yaml` tanpa
handler, dan bukan duplikat identik dari `hermes-cloud-hook/` melainkan versi
yang lebih miskin (tanpa daftar `events`). Rujukannya di `ARCHITECTURE.md`
ikut dibersihkan.

**Verifikasi Fase 6:** 154 test lulus · lint bersih · build 217 kB · shutdown
PASS · 258/258 aset · workflow cocok dengan sumber kanonik · nol host
hardcoded · boot bersih tanpa konfigurasi dengan semua integrasi opsional
dilaporkan `off`.


---

# Fase 7 — Test frontend (6 Okt 2026)

Sebelum ini angkanya 154 test backend berbanding **nol** test frontend. Yang
membuatnya mendesak bukan rasio itu, melainkan *apa* yang tidak diuji:
`ApprovalGate` dan `AuditBadge` menegakkan kontrak redaksi guest, dan sejak
auto-guest mendarat kontrak itu adalah **satu-satunya** batas antara
pengunjung anonim dan peta privilese. Dalam penjualan dengan ancaman denda
€15 juta, "gerbang persetujuan tidak punya satu pun tes" adalah keberatan yang
sah dan mudah ditembak.

Stack: Vitest + Testing Library + jsdom. **44 test, 4 berkas.**

## Apa yang dipasak

**`ApprovalGate` (9)** — sisi klien dari kontrak redaksi. Tampilan owner
menampilkan `agent` dan `tool`; tampilan guest tidak boleh menampilkan
keduanya *dan* tidak boleh menawarkan tombol yang dijamin 403. Satu tes
menyapu seluruh `innerHTML` mencari kata terlarang alih-alih memeriksa field
satu per satu — redaksi yang bocor lewat atribut, `title` atau `data-*` akan
lolos dari pemeriksaan yang lebih sempit tapi tetap memajang peta privilese di
DOM.

**`AuditBadge` (11)** — hilang total pada 401/403, bukan menawarkan kontrol
mati. Memulai di keadaan `unknown`: memegang hash kepala **bukan** berarti
rantainya sudah dihitung ulang, dan mengklaim "verified" saat muat adalah
jaminan yang tidak diperoleh. Rantai rusak harus berteriak — `CHAIN BROKEN`
plus alasan dan nomor rekaman. Satu tes memasak kalimat **"Tamper-evident, not
tamper-proof"** agar tidak pernah hilang: truncation ekor dan regenerasi utuh
memang tidak terdeteksi, dan melebih-lebihkan itu adalah satu hal yang akan
membuat seluruh cerita kepatuhan menjadi tidak jujur.

**`useBurnState` (10)** — mencegah kembalinya poller. Loop polling adalah hal
termudah untuk disisipkan ulang dan tersulit untuk disadari: semuanya tetap
bekerja, hanya saja berbiaya satu request per detik selamanya. Juga memasak
dua alasan socket tidak bisa jadi satu-satunya sumber, transisi ber-scope agen
yang tidak boleh membakar seluruh ruangan, dan penolakan nilai `state` yang
tidak dikenal di batas — nilai asing akan lolos ke tabel grade shader dan
jatuh ke `undefined`.

**`AtmosphereLayer` (10)** — justru jalur terdegradasi yang menarik. jsdom
tidak punya WebGL2 sama sekali, jadi tes ini menguji lingkungan yang persis
dihadapi Safari lama, browser terkunci dan webview tertanam. Kontraknya:
ruangan harus tetap tampil baik tanpa udaranya. Dashboard tata kelola yang
menampilkan kotak hitam karena shader gagal lebih buruk daripada yang tanpa
atmosfer.

## Tiga kali tes saya salah, bukan kodenya

Layak dicatat karena polanya sama setiap kali: **saya menulis tes dari asumsi,
bukan dari kode.**

1. Fixture `/approvals` saya buat array telanjang. Server membungkusnya:
   `{ pending: [...] }` (`index.js:515`).
2. `AuditBadge` saya asumsikan punya `data-testid` dan atribut
   `data-verified`. Tidak punya keduanya — keadaannya ada di kelas root
   `.audit-{unknown|verified|broken}`.
3. Fixture IP di Fase 6 saya ganti ke `203.0.113.10`, yang **publik**, jadi
   sanitizer benar tidak meredaksinya dan tes benar gagal.

Dalam ketiga kasus, tesnya yang diperbaiki, bukan komponennya. Fixture yang
tidak cocok dengan server tidak membuktikan apa pun — ia hanya memasak
kesalahpahaman penulisnya.

## Dev proxy: seluruh permukaan Fase 1–4 hilang

Ditemukan sambil menyiapkan Vitest. `vite.config.ts` memproksikan `/chat`,
`/roster`, `/event`, `/health`, `/presence`, `/github`, `/auth` — dan tidak
satu pun dari `/burn`, `/budget`, `/policy`, `/approvals`, `/agents`,
`/ledger`, `/dossier`, `/v1`.

Artinya di bawah `npm run dev`, **HUD burn, gerbang persetujuan dan badge
audit diam-diam tidak berfungsi**, sementara semuanya sempurna di build
produksi. Daftar ini sudah salah dua kali sebelumnya (port keliru, lalu lima
rute hilang), jadi sekarang menjadi satu daftar `HTTP_ROUTES` eksplisit
berkomentar fase — bentuk yang membuat kelalaian terlihat saat ditinjau.

**Verifikasi Fase 7:** 154 test backend · **44 test frontend** · lint bersih ·
build 217 kB (tes ikut di-typecheck oleh `tsc`) · shutdown PASS · 258/258 aset ·
workflow cocok · nol host hardcoded.


---

# Fase 8 — Dokumentasi yang tidak bisa berbohong

## Masalahnya bukan dokumen yang tipis

`docs/ARCHITECTURE.md` sebelumnya 193 baris dan menggambarkan repo sebelum
Fase 1–7 ada: tanpa OTLP, tanpa burn-rate, tanpa policy, tanpa flight
recorder, tanpa donghua. Orang yang membacanya akan membangun model mental
yang salah tentang separuh sistem.

Tapi kegagalan yang lebih mahal di repo ini bukan dokumen yang ketinggalan —
melainkan dokumen yang **percaya diri dan keliru**. Dua preseden:

- Penjelasan soal CI yang hilang ditulis salah **dua kali berturut-turut** di
  changelog ini sebelum `ls` dibanding `find -name '.*'` menunjukkan
  mekanisme sebenarnya (direktori berawalan titik tidak bertahan).
- `server/github.js` memanggil `/orgs/Niumination/repos`. `Niumination` adalah
  User, bukan Org. Endpoint itu **tidak akan pernah** mengembalikan 200, dan
  tidak ada dokumen yang menangkapnya.

Prosa tidak di-type-check. Itu satu-satunya artefak di repo yang bisa
membusuk sambil seluruh CI tetap hijau.

## Yang dikerjakan

**Inventaris dulu, menulis belakangan.** Sebelum satu kalimat pun ditulis:
daftar 13 modul server dengan hitungan baris, **semua rute diekstrak dari
`index.js` lewat regex beserta guard-nya**, 30 berkas frontend, 8 skrip, 18
pelat, 250 sprite. Dokumen dibangun dari inventaris itu, bukan dari ingatan.

**`docs/ARCHITECTURE.md` ditulis ulang total** — 193 → ~280 baris, 11 bagian:
tiga pilar; peta modul; diagram aliran data; tabel rute + guard lengkap;
model keamanan auto-guest; tabel jujur "terdeteksi / tidak terdeteksi" untuk
flight recorder; lapisan visual + perbandingan R3F; pengujian; deployment;
**§10 tujuh jebakan yang sudah memakan korban**; §11 utang yang diketahui.

§10 dan §11 adalah bagian yang paling berharga. Dokumen arsitektur biasanya
hanya memuat apa yang berhasil. Yang menghemat waktu orang berikutnya adalah
daftar hal yang sudah mencelakai orang sebelumnya.

## `scripts/check-docs.py` — klaim dieksekusi, bukan dipercaya

19 klaim diperiksa terhadap repo:

- hitungan baris 13 modul server
- jumlah pelat ruangan dan sprite
- **tabel rute dua arah**: rute di `index.js` tanpa baris tabel → gagal;
  rute terdokumentasi yang tidak ada di kode → gagal
- hitungan test backend dan frontend

Dua arah itu penting. Pemeriksa satu arah hanya menangkap dokumen yang
tertinggal; ia melewatkan dokumen yang **mengarang** — persis kategori
kesalahan `/orgs/Niumination/repos`.

Diverifikasi dengan menyuntikkan kebohongan, bukan dengan melihatnya hijau:

| Sabotase | Hasil |
|---|---|
| `policy.js 585` → `999` | FAIL — "doc says 999, repo has 585" |
| tambah baris `GET /admin/secrets` | FAIL — "documented but does not exist" |
| hapus baris `POST /v1/traces` | FAIL — "in index.js with no row" |
| dipulihkan | PASS 19/19 |

## Dua bug di pemeriksa itu sendiri

1. `UnboundLocalError` pada `checks` — perlu `global`.
2. **False positive yang lebih berbahaya:** saat `node_modules` hilang, suite
   hanya mengumpulkan 74 dari 154 test, dan pemeriksa melaporkan "dokumen
   basi". Lingkungan yang rusak menyamar sebagai dokumen yang salah. Kini
   `node_modules` hilang dan `ERR_MODULE_NOT_FOUND` jadi kategori terpisah
   dengan pesan `run npm ci`.

Pemeriksa yang kadang melapor salah akan dilatih untuk diabaikan, dan
pemeriksa yang diabaikan lebih buruk daripada tidak ada.

## CI dan README

`check-docs.py` masuk job `server` di `ci/workflow.yml`, lewat
`scripts/install-ci.sh` seperti biasa. README mendapat deskripsi pembuka yang
menjual denah-lantai-sebagai-kebijakan, bagian tema donghua (termasuk
+7,8 kB vs ~250 kB dan degradasi tanpa WebGL2), serta blok "setelah clone"
yang menyebut `install-ci.sh` — karena `.github/` tidak bertahan di arsip.

## Baseline

154 backend · 44 frontend · lint bersih · build 217 kB · 5 skrip PASS.


---

# Fase 9 — Test untuk `agentManager.ts`

## Berkas terbesar, nol test

396 baris, berkas logika terbesar di frontend, dan satu-satunya yang sama
sekali tidak diuji. Ia juga satu-satunya modul yang **sengaja acak**: jitter
waypoint, lemparan dadu detour 20%, dan lima kolam pesan semuanya memanggil
`Math.random()`.

Keacakan itulah alasannya tidak pernah diuji — dan persis alasan ia butuh
test. Modul non-deterministik adalah modul yang tidak berani di-refactor
siapa pun.

Pendekatan: `Math.random` di-stub dengan urutan terskrip per-test sehingga
setiap cabang terjangkau dan assertion-nya eksak. Di tempat yang nilainya
memang boleh bervariasi, yang di-assert adalah **invariannya** — keanggotaan,
batas, determinisme — bukan literalnya.

## 75 test

`assignSpot` 5 · `stepToward` 6 · `findWaypointPath` 9 · `getEffect` 24 ·
kolam pesan 16 · `createAgent` 8 · konstanta tuning 3.

Beberapa di antaranya **test karakterisasi, bukan dukungan** — perilaku yang
bisa diperdebatkan salah, dipasak supaya tidak berubah diam-diam:

- Bos yang sedang istirahat **minum air** tetap dapat Red Bull, karena cek
  `boss-` berada di atas cek hidrasi. Hampir pasti tak disengaja, sepenuhnya
  tak berbahaya.
- Graf waypoint yang terputus membuat `findWaypointPath` mengembalikan titik
  awal saja — agen lalu berjalan lurus menembus dinding. Dapat diterima untuk
  visualiser kosmetik; dicatat supaya perubahan pathfinding nanti punya test
  untuk diperbarui, bukan kejutan untuk ditemukan.
- Cabang prop Office-TV mati di fork ini (`themeShim` selalu `null`).

Test yang paling berguna justru yang membosankan: `stepToward` pada jarak nol
tidak boleh membagi dengan nol — tanpa guard itu agen mendarat di posisi
`NaN` dan hilang permanen dari layar.

## Diverifikasi dengan mutasi, bukan dengan warna hijau

Enam bug disuntik ke `agentManager.ts`; keenamnya terbunuh:

| Mutasi | Test gagal |
|---|---|
| guard overshoot `dist <= speed` dilepas | 4 |
| `assignSpot` lupa menyaring tipe `desk` | 2 |
| minuman energi jadi acak, bukan hash per-agen | 2 |
| ambang tidur `> 30s` → `>= 30s` | 1 |
| `createAgent` spawn di meja, bukan di pintu | 1 |
| jitter dilipatgandakan 10× | 1 |

## Satu test saya salah, lagi

Test fallback graf terputus meng-assert `{x:90,y:90}` padahal komentar yang
saya tulis sendiri tepat di atasnya berkata "titik **awal**". Kodenya benar
(`{x:0,y:0}`); assertion saya bertentangan dengan prosa saya sendiri. Ini
kali keempat dalam proyek ini test saya yang salah, bukan kodenya.

## Pemeriksa dokumen lolos karena kebetulan

Setelah 75 test masuk, `check-docs.py` tetap melaporkan **PASS** untuk klaim
"44 test frontend". Ia mem-*glob* `frontend/src/**/*.test.tsx` saja —
`agentManager.test.ts` tanpa `x` tidak terlihat. Klaim 44 itu benar hanya
karena kebetulan cocok dengan jumlah berkas `.tsx`.

Separuh keduanya juga rusak: `it.each([...])` dihitung dengan membelah pada
koma, yang salah untuk setiap tabel yang barisnya berupa array — dan hampir
semua tabel saya begitu.

Diganti: pemeriksa sekarang **menjalankan vitest dan membaca hitungannya**,
sama seperti sisi backend, lengkap dengan pemisahan "lingkungan rusak" vs
"dokumen basi". Lebih lambat empat detik. Pemeriksa yang salah secara percaya
diri lebih buruk daripada pemeriksa yang lambat.

Dipasak ulang dengan sabotase: klaim `119` → `120` kini FAIL dengan
`doc says '120', repo has '119'`.

ARCHITECTURE.md §10 dapat jebakan baru (kini 8), dan baris utang
"belum ada test untuk agentManager.ts" dihapus karena sudah lunas.

## Baseline

154 backend · **119 frontend** · lint bersih · build 216 kB · 5 skrip PASS.


---

# Fase 10 — PRD & UI-SPEC ditulis ulang, lalu dikunci

## Dua dokumen yang menjual produk yang tidak ada

`PRD.md` (359 baris) dan `UI-SPEC.md` masih v1 dari 3 Okt 2026. Keduanya
berada **di luar** jangkauan `check-docs.py`, dan membusuk persis seperti yang
diprediksi — diam-diam, sementara seluruh CI tetap hijau.

Inventaris sebelum menulis (bukan dari ingatan) menemukan klaim-klaim ini
salah:

| Klaim v1 | Kenyataan |
|---|---|
| "canvas ~70% width, tile grid" | **Bukan canvas.** React DOM, posisi persentase. |
| Tabel SQLite `events` + tabel `reactions` | Event di ring buffer memori; reaksi = kolom JSON di `messages` |
| Rute `/api/agents` | Tidak pernah dibangun |
| `GITHUB_ORG` default `"Niumination"` | Default yang **tidak akan pernah** berhasil — User, bukan Org |
| Niu-mode tema penuh | Stub: palet + string + toggle `/niu` |
| Confetti, music box, gamelan, "yes boss?" | Tidak satu pun dibangun |
| Pixel art | Donghua 3D sejak Fase 5 |
| Estimasi 12–16 hari untuk v1.0 | v1.0 terkirim; v2 menumpuk Fase 0–9 di atasnya |

Yang **benar** juga diperiksa: `/chat/react` dan `/chat/typing` ternyata ada —
grep pertama saya meleset karena path-nya `/react` di dalam router. Hampir
saja saya "mengoreksi" dokumen dengan menghapus dua rute yang nyata. Verifikasi
mekanismenya, jangan percaya grep pertama.

## PRD v2

Ditulis ulang total, 15 bagian. Posisi berubah dari "alat pribadi untuk
melihat ekosistem saya" menjadi **produk tata kelola yang bisa dijual**:
tiga pilar (ingest OTLP / tata kelola spasial / perekam penerbangan), bukti
pasar dengan angka (IDC 96% vs 44%, AI Act Pasal 99(4) €15 juta, OWASP LLM10,
Langfuse 35.372★ vs kategori kantor-piksel yang mentok ~200★), empat persona
termasuk auditor dan FinOps, spesifikasi fitur sebagaimana-dibangun, model
data nyata, tujuh ADR, tujuh risiko, dan **§13 tabel jujur "apa yang berubah
dari v1"**.

§13 itu yang paling saya pedulikan. Menghapus janji tanpa jejak adalah cara
sebuah dokumen kehilangan kepercayaan; mencatat "ini dijanjikan, ini tidak
dibangun" justru membangunnya.

## UI-SPEC v2

11 bagian. Bahasa visual donghua (lima isyarat cahaya, mana yang dipanggang ke
sprite vs mana yang dari shader), tumpukan z-index dan alasan shader duduk di
z=2, tabel burn-state → suasana ruangan, token OKLCH, komponen tata kelola,
dan §11 daftar koreksi terhadap v1.

Satu catatan aksesibilitas yang diperluas: `prefers-reduced-motion`
**membekukan waktu, tidak menghapus lapisannya** — karena god ray membawa
burn state. Menghapusnya demi pengguna sensitif gerak akan menghapus
informasi tata kelola. Buang animasinya, pertahankan sinyalnya.

## Dibawa ke dalam cakupan pemeriksa

`check-docs.py` diperluas dari 19 → **37 klaim**, kini mencakup ketiga
dokumen. Yang baru diperiksa: hitungan rute (tingkat-atas + sub-rute chat),
ruangan/pelat/sprite, hitungan baris keempat berkas CSS, token OKLCH,
**hitungan `!important`** (utang yang diketahui tidak boleh dikecilkan diam-
diam), hitungan baris komponen, arah cahaya `LIGHT_DX/LIGHT_DY` yang harus
sepakat antara dokumen dan `stylize-donghua.py`, serta dua kalimat pendirian
yang wajib tetap tertulis ("tidak pernah membaca isi prompt", "jangan pernah
per-kursi").

### Dua bug di pemeriksa, lagi

1. Ia menghitung **path unik**, bukan pasangan (metode, path) — jadi `GET` dan
   `POST` pada `/approvals/:id` menyatu jadi satu. Dua rute dengan dua guard
   dan dua mode gagal yang diciutkan jadi satu adalah cara tabel rute
   kehilangan endpoint yang lalu tak pernah ditinjau.
2. Regex sub-rute chat mencari `router.get(` padahal routernya bernama `r`.
   Hasilnya **0** dan nyaris lolos sebagai "0 sub-rute". Sekarang ia mencocokkan
   receiver apa pun, jadi mengganti nama variabel tidak bisa mematikan
   pemeriksaan ini.

Keduanya ditemukan karena pemeriksa itu **gagal** saat pertama dijalankan —
bukan karena saya membacanya ulang.

## Diverifikasi dengan delapan sabotase

| Sabotase | Tertangkap sebagai |
|---|---|
| hitungan rute 21 → 22 | `doc says '22', repo has 21` |
| hitungan pelat 18 → 17 | `doc says '17', repo has 18` |
| pagar "tidak pernah baca prompt" dihapus | `PRD no longer states: ...` |
| `office.css` 1.582 → 1.600 | `doc says '1600', repo has 1582` |
| utang `!important` 7 → 3 | `doc says '3', repo has 7` |
| arah cahaya dibalik `-2,-3` → `-3,-2` | `doc says '-3,-2', repo has '-2,-3'` |
| `ApprovalGate` 171 → 150 baris | `doc says '150', repo has 171` |
| **kode:** "Tamper-evident, not tamper-proof" → "Fully tamper-proof" | **dua jaring**: test frontend turun 119→118 **dan** pemeriksa dokumen |

Yang terakhir itu tujuan sebenarnya. Kalimat kepatuhan yang "dipoles" tim
pemasaran ditangkap oleh suite test **dan** oleh pemeriksa dokumen, lewat dua
jalur independen.

## Harness test saya sendiri salah, lagi

Sapuan sabotase pertama mencetak delapan baris kosong dan sempat tampak
seperti delapan kegagalan mendeteksi. Penyebabnya saya mem-`grep` empat spasi
sementara outputnya dua. Pemeriksanya benar sepanjang waktu; alat ukur saya
yang rusak. Kali kelima dalam proyek ini perkakas test saya yang salah, bukan
kodenya.

## Baseline

154 backend · 119 frontend · lint bersih · build 216 kB · 5 skrip PASS
(**37 klaim dokumen**).


---

# Fase 11 — Penambatan ledger: menutup celah Pilar C

## Celah yang sudah dinyatakan sejak Fase 4

`FLIGHT-RECORDER.md` menyatakan dua serangan yang **tidak** dideteksi rantai:

- **Pemotongan ekor** — buang N record terakhir dan sisanya terverifikasi
  sempurna. Ia memang rantai yang valid, hanya lebih pendek.
- **Regenerasi menyeluruh** — bangun ulang seluruh rantai dari input palsu dan
  setiap hash konsisten secara internal.

Keduanya lolos `GET /ledger/verify` dengan centang hijau. Komentar di
`ledger.checkpoint()` bahkan sudah menunjuk jalan keluarnya sejak Fase 4:
*"Export them and truncation becomes detectable."* Yang belum dibangun adalah
ekspornya.

Ini tidak bisa diperbaiki dari dalam berkas. Rantai hanya bisa membuktikan
konsistensi dirinya; ia tidak bisa membuktikan bahwa versi yang lebih panjang
pernah ada. Perbaikannya bukan kriptografis melainkan **sosial**: terbitkan
hash kepala ke tempat yang tidak bisa diraih ulang server ini.

## `server/anchor.js`

`AnchorStore` menerbitkan `{seq, hash, records, ts, note}` ke dua jenis sink
dan membandingkan setiap tambatan terbit terhadap rantai hidup. Tiga hasil per
tambatan: `ok`, `truncated` (rantai kini lebih pendek daripada yang kita
terbitkan), `diverged` (ada record di seq itu tapi hash-nya lain — dibangun
ulang, bukan sekadar dipangkas). `diverged` lebih buruk dan dilaporkan dulu.

**Tambatan tidak disimpan di dalam `ledger.db`.** Tambatan yang berada di
dalam artefak yang ia tambatkan adalah tanda tangan di atas pemalsuannya
sendiri. Ada test khusus untuk properti struktural ini.

**Kekuatan bukan biner, dan tidak boleh dibulatkan ke atas.** Berkas lokal
ada di disk yang sama — root menulis ulang keduanya. Itu tidak membuatnya
tak berguna: ia menahan kasus realistis (proses atau operator menyunting
`ledger.db`, bug aplikasi, pemulihan sebagian) dan harganya nol. Jadi
`verify()` memberi label `local` vs `remote`, dan **seribu tambatan di disk
yang sama tetap `local`**. Ada test untuk itu juga.

**Tidak pernah memblokir.** Aturan yang sama dengan ledger: gagal menambat
tidak pernah menolak aksi atau mematikan proses. Fitur audit yang bisa
menjatuhkan produk adalah fitur audit yang akan dimatikan operator.

## Yang berubah di tempat lain

- `ledger.js`: tipe record `chain_anchored`, dan metode `at(seq)` — verifikasi
  tambatan butuh hash **pada** satu seq, bukan pemindaian rentang.
- `GET /ledger/verify` kini memuat `anchors` **dan** satu bidang
  `trustworthy` = konsisten-internal **dan** konsisten-tambatan. Keduanya
  dipisah, tidak dilebur jadi satu boolean, supaya pembaca melihat jaminan
  **yang mana** yang berlaku. `ok` tetap `true` pada rantai yang dipotong —
  itulah intinya.
- `GET /ledger/anchors`, `POST /ledger/anchor` (owner). POST membalas **207**
  kalau sebagian sink gagal; 200 datar akan menyembunyikannya.
- Boot memverifikasi terhadap tambatan, karena saat paling mungkin sebuah
  rantai dirusak adalah ketika proses ini **tidak** berjalan.
- Shutdown menambat secara lokal-sinkron saja — anggaran shutdown 5 detik,
  dan webhook lambat akan mengubah keluar-dengan-rapi menjadi SIGKILL.
- URL diredaksi (kredensial + query string) sebelum masuk balasan atau log.
  Token webhook hidup di query string; tanpa ini mereka satu tangkapan layar
  dari bocor.

## Uji sungguhan, bukan hanya unit test

Server dijalankan, ledger dipotong dengan SQLite langsung saat server mati,
lalu di-boot ulang:

```
[ledger] /tmp/anc/ledger.db — 2 records, head 6c7e91b4655a…
[anchor] CHAIN FAILED ANCHOR CHECK: anchor published seq 4 but the chain now
         ends at 2 — 2 record(s) that provably existed are missing

rantai internal ok : True    <-- HIJAU, persis masalahnya
anchor ok          : False
trustworthy        : False
```

31 test baru (**185 backend** total). Enam mutasi disuntik ke `anchor.js`,
enam terbunuh: cek pemotongan dilumpuhkan → 1 gagal, cek divergensi → 2,
webhook 404 dianggap sukses → 1, lokal-saja mengaku `remote` → 1, urutan
`diverged`/`truncated` dibalik → 1, redaksi URL dimatikan → 2.

## Efek samping yang dicatat, bukan disembunyikan

Saat boot mendeteksi pemotongan, server menulis record `chain_truncated` — dan
record itu **menempati nomor urut yang baru saja dikosongkan**. Boot
berikutnya karena itu melaporkan `diverged`, bukan `truncated`. Tetap
terdeteksi, tetap gagal, tapi labelnya berubah. Ini konsekuensi nyata dari
mencatat ke dalam artefak yang sedang diperiksa; didokumentasikan di
FLIGHT-RECORDER.md alih-alih dibiarkan mengejutkan seseorang saat audit.

## Yang masih tidak terdeteksi

Server yang berbohong **sejak awal** — tidak pernah mencatat sebuah keputusan
sama sekali. Tidak ada rantai yang bisa menangkap itu; nomor urut bersambung
hanya membuktikan tidak ada yang dihapus *setelah* ditulis. Batas permanen,
dan kini tertulis.

## Dua koreksi pada diri sendiri

1. Saya menulis `appendFileSync` di `index.js` yang **tidak pernah mengimpor
   `node:fs`**. `node --check` lolos karena itu kesalahan runtime, bukan
   sintaks. Ketahuan saat memeriksa impor, bukan saat parse. Logikanya
   dipindah ke `AnchorStore.publishLocalSync()`, yang memang tempatnya.
2. Lint menolak `new Promise(r => setTimeout(r, 45))` di tiga tempat
   (`no-promise-executor-return`), dan menemukan saya mengimpor `ANCHOR_OK`
   tanpa pernah mengujinya. Konstanta itu sekarang dipakai dalam assertion,
   bukan dihapus dari impor.

## Baseline

**185 backend** · 119 frontend · lint bersih · build 216 kB · 5 skrip PASS
(38 klaim dokumen).


---

# Fase 12 — Time Machine

## Lipat ledger, dapatkan kantor

`server/replay.js` melipat perekam penerbangan ke depan menjadi urutan frame:
siapa di ruangan mana, burn state saat itu, persetujuan yang menggantung,
apa yang diizinkan dan ditolak. `GET /replay?from=&to=`, owner saja.

44 test baru → **229 backend**.

## Tiga keputusan yang menentukan apakah ini bukti atau hiburan

**1. Pra-gulung wajib.** Replay yang mulai pukul 02:00 tetap perlu tahu
posisi semua orang pada 01:59, jadi lipatan selalu dimulai dari awal rantai
dan baru *memancarkan* frame saat mencapai `from`. Mulai dingin akan
menampilkan kantor kosong yang perlahan terisi saat orang kebetulan
berpindah — terlihat seperti evakuasi, padahal murni kesalahan rekonstruksi.
Mutasi yang melumpuhkan pra-gulung membunuh 4 test.

**2. Determinisme adalah fiturnya, bukan detailnya.** Rentang yang sama wajib
menghasilkan frame identik byte per byte. Tidak ada `Math.random`, tidak ada
`Date.now`, tidak ada iterasi atas map tak-berurut; semua koleksi diurutkan
sebelum dipancarkan. Ada test yang membandingkan dua lipatan sebagai string.
Artefak insiden yang berbeda antar dua kali jalan tidak bisa dipakai sebagai
bukti.

**3. Agent punya RUANGAN, bukan koordinat.** Hanya perpindahan ruangan yang
dicatat ledger. Jalan kaki, istirahat kopi, gerak di meja — tak satu pun ada
di rantai, karena tak satu pun keputusan tata kelola. Replay yang mengarang
posisi itu adalah dramatisasi yang disajikan sebagai bukti. Renderer karena
itu sengaja **tidak** menggambar pelat isometrik atau sprite; tampilan
diagram adalah tampilan yang jujur.

Setiap replay membawa kepala rantai, hasil `verify()`, dan vonis tambatan
(Fase 11) **di dalam** payload — replay dari rantai yang dipotong adalah
replay dari rantai yang dipotong, dan harus bisa diperiksa berbulan-bulan
kemudian.

Tidak ada versi tamu dari endpoint ini, sengaja. Replay separuh-redaksi
adalah artefak insiden yang berlubang persis di tempat yang dibutuhkan
penyelidik.

## GIF, bukan MP4 — dan alasannya

Roadmap menulis "ekspor MP4". Tidak ada `ffmpeg` di sini, dan menambah
dependensi biner demi demo yang lebih cantik merusak `npm ci && npm start`
bagi setiap pengguna yang tak memilikinya. PIL sudah jadi dependensi pipeline
seni, menulis GIF animasi secara native, dan hasilnya bisa ditempel ke Slack,
PR, dan tiket insiden tanpa negosiasi codec. Kalau MP4 nanti dibutuhkan, satu
panggilan ffmpeg atas frame yang sama cukup — bagian sulitnya sudah selesai.

`scripts/replay-to-gif.py` dijalankan atas sesi sungguhan (tiga agent, tangga
burn `normal → warm → hot → critical → tripped`, 7 penolakan) → 24 frame,
`/home/user/time-machine.gif`.

## Dua bug saya sendiri, ditemukan dengan melihat hasilnya

**1. Layout membuang 60% kanvas.** Grid dipatok tiga baris padahal replay
hanya menyentuh empat ruangan. Kantor kecil tampak seperti kantor yang
ditinggalkan. Tinggi kanvas kini dihitung dari jumlah ruangan — sekali, lalu
dipakai semua frame, karena GIF yang kanvasnya berubah di tengah pemutaran
ditolak separuh penampil.

**2. Header berkata `BURN: HOT` di samping `$1,12`** — dan angka itu berasal
dari transisi `warm` beberapa record sebelumnya. Burn diperbarui pada setiap
keputusan; belanja terealisasi hanya pada transisi anggaran. Bukan bug di
lipatan, tapi menyandingkan keduanya seolah terukur bersamaan adalah
kebohongan kecil yang akan ditangkap auditor.

Perbaikan: setiap frame kini membawa `spentAsOfSeq`, dan renderer menulis
`(per seq 14)` saat angkanya basi. Dua test baru memasak itu.

**Lalu perbaikan itu sendiri punya bug:** render berikutnya mencetak
*"belum ada belanja tercatat"* di atas frame senilai $1,12. Renderer
menyamakan **"field tidak ada"** (berkas replay lama) dengan **"nol"**.
Keduanya hal yang berbeda, dan sekarang dibedakan.

Ketiganya ketahuan karena saya **membuka berkas GIF-nya dan melihat**, bukan
karena ada test yang gagal. Test tidak merender.

## Mutasi

| Mutasi di `replay.js` | Test gagal |
|---|---|
| pra-gulung (seeding) dilumpuhkan | 4 |
| snapshot tidak menyalin/mengurut | 15 |
| breaker per-agen mengecat seluruh kantor | 1 |
| `peakBurn` jadi state terakhir, bukan tertinggi | 1 |
| frame tersampel tidak ditandai | 1 |

`peakBurn` layak disebut: insiden yang **pulih** tetap pernah terjadi.
Melaporkan state terakhir alih-alih tertinggi akan menyembunyikan tepat
kejadian yang dicari orang saat membuka replay.

## Baseline

**229 backend** · 119 frontend · lint bersih · build 216 kB · 5 skrip PASS
(39 klaim dokumen).


---

# Fase 13 — Mode kiosk

`GET /kiosk`: halaman status layar penuh untuk TV di sudut kantor klien. Satu-
satunya fitur yang menjual produk **saat tidak ada yang memakainya**. 35 test
baru → **264 backend**.

## Keputusan yang menentukan seluruh desain: ia menurunkan haknya sendiri

Kiosk merender tampilan **tamu** secara default, bahkan ketika permintaan
membawa cookie owner yang sah.

Ini terlihat salah sampai Anda membayangkan deployment sebenarnya. Layar ada
di dinding. Ia dilihat tamu, petugas kebersihan, kurir, dan setiap kamera
ponsel di ruangan. Orang yang memasangnya melakukannya dari laptopnya sendiri
dalam keadaan login sebagai owner, dan **tidak akan pernah memikirkan cookie
itu lagi**. Default ke tampilan owner = menaruh angka dolar di dinding publik,
selamanya, tanpa sengaja.

| Permintaan | Dolar |
|---|---|
| anonim / tamu | tidak |
| tamu + `?reveal=1` | **tidak** |
| owner | **tidak** |
| owner + `?reveal=1` | ya, **hanya per jam** |

Belanja harian dan seumur hidup tidak pernah muncul bahkan dengan reveal. Per
jam adalah angka operasional; sisanya metrik bisnis yang tak seorang pun minta
dipublikasikan. Rasio **memang** lolos tanpa reveal — ia suhu, bukan jumlah,
dan sudah ada di kontrak tamu sejak Fase 2.

Redaksi diputuskan di **model**, bukan di template. Redaksi yang hidup di
dalam template adalah redaksi yang tak seorang pun bisa uji; test di sini
meng-assert data, lalu menyapu seluruh HTML untuk tanda `$`.

## Dua cacat lapangan yang hanya muncul saat dijalankan sungguhan

**1. TV anonim mendapat 401.** Auto-guest hanya dicetak di `GET /`. Layar
dinding membuka satu URL saat boot dan tidak punya cara login — ia akan
menampilkan 401 selamanya. Middleware auto-guest kini dipakai bersama oleh
`/` dan `/kiosk`.

**2. Lalu perbaikan itu tetap 401.** Cookie yang dicetak hanya terkirim pada
permintaan **berikutnya**, jadi permintaan yang mencetaknya gagal
autentikasinya sendiri. `GET /` tidak pernah menyadarinya karena ia
menyajikan berkas statis tanpa auth. Middleware sekarang menempelkan cookie
ke `req.headers.cookie` juga — permintaan pertama berhasil, diverifikasi
terhadap server hidup.

Keduanya hanya ketahuan karena saya menjalankan `curl` tanpa kredensial, bukan
dari unit test. Test memanggil fungsi render; mereka tidak membuka URL.

## Tanpa build, tanpa jaringan, basi ditampilkan

HTML mandiri — CSS inline, tanpa font, tanpa CDN, tanpa bundle. Kiosk yang
rusak saat pipeline aset berubah adalah kiosk yang akan rusak saat rapat
direksi. Ada test yang menolak `<link>`, `src=http`, `@import`, dan web font.

Dirender di server, jadi cat pertama benar **tanpa JavaScript**; loop
penyegaran hanya peningkatan progresif dengan `<noscript><meta refresh>`
sebagai lantai.

Lewat 45 detik tanpa penyegaran berhasil, halaman berganti ke `TERPUTUS —
data Ns lalu` berwarna merah sambil mempertahankan frame terakhir yang baik.
Layar dinding yang membeku pada data basi tapi tampak hidup lebih buruk
daripada tidak ada layar: ia dipercaya justru karena tak ada yang
berinteraksi dengannya. Kegagalan beruntun memperlambat polling sampai 5
menit — server mati tidak boleh dihajar layar yang tak ditonton.

## Keamanan render

Halaman ini **satu-satunya** tempat di produk yang merender string telemetri
sebagai markup mentah. Nama agent dan label ruangan adalah string sembarang
yang bisa dipengaruhi penyerang. Setiap interpolasi lewat `esc()`; ada test
yang memasukkan `<script>alert(1)</script>` dan `" onload=` sebagai nama
agent.

## Mutasi

| Mutasi di `kiosk.js` | Test gagal |
|---|---|
| `reveal` diabaikan — dolar selalu tampil | 1 |
| escaping `<` dimatikan (XSS) | 2 |
| escaping kutip dimatikan | 2 |
| bar rasio tak di-clamp | 1 |
| burn state tak dikenal → halaman rusak | 2 |
| occupant kosong tak disaring/diurutkan | 2 |
| fallback `noscript` dihapus | 1 |

Tiga test terakhir di berkas itu menyasar rasa malu khas layar dinding:
ruangan yang diam-diam hilang dari grid, kantor kosong di malam hari yang
terlihat seperti error, dan kata `undefined` di dinding.

## Baseline

**264 backend** · 119 frontend · lint bersih · build 216 kB · 5 skrip PASS
(40 klaim dokumen).


---

# Fase 14 — Standup

`GET /standup`: ringkasan pagi yang pendek dan berperingkat, diturunkan
seluruhnya dari flight recorder. Owner saja. 40 test baru → **304 backend**.

Ia menjawab satu pertanyaan: *"Apa saya perlu melakukan sesuatu hari ini?"*

## Ia bukan dossier yang dipendekkan

| | dossier (Fase 4) | standup (Fase 14) |
|---|---|---|
| pembaca | auditor yang **tidak** memercayai Anda | operator yang sudah percaya, punya 4 menit |
| isi | lengkap, netral, menarasikan tiap catatan | lossy, berperingkat, berpendapat |
| panjang | kebajikan | **cacat** |

Keduanya tidak boleh bertemu di tengah. Permintaan "sedikit lebih detail" di
standup dijawab dengan tautan ke dossier.

## Aturan yang menentukan seluruh fitur

**Standup yang selalu punya sesuatu untuk dikatakan adalah kebisingan.**

Setiap laporan harian otomatis mati dengan cara yang sama: ia memadatkan
ruang kosong. "Penolakan: 0. Izin: 0. Semua normal." setiap pagi, sampai
orang memfilternya ke folder yang tak pernah dibuka — lalu ia tidak berguna
pada satu-satunya pagi yang penting.

Jadi temuan harus melewati ambang untuk dicetak, bagian kosong dihilangkan
alih-alih dirender sebagai "Tidak ada", dan malam yang tenang menghasilkan
**satu baris**. Ada test yang memastikan hari sepi ≤6 baris dan tidak memuat
kata "kedaluwarsa" sama sekali, serta test bahwa 500 keputusan sehat tetap
dianggap sepi — volume saja bukan berita.

Pengecualiannya satu: integritas rantai selalu dicetak. Diam tentang log
audit tidak bisa dibedakan dari log audit yang hilang.

## Tanpa panggilan model

Templating deterministik; rentang ledger yang sama → teks identik
byte-per-byte. Gratis, tak bisa kena rate-limit pukul 09:00, dan tak bisa
berhalusinasi tentang penolakan yang tak pernah terjadi.

Alasan terpentingnya bukan teknis: produk yang tesisnya *"agent menghabiskan
uang sungguhan dan butuh pagar"* tidak boleh membakar token untuk memberi
tahu Anda berapa token yang Anda bakar. Memasang LLM di sini berarti
menggugurkan argumen sendiri di depan calon pembeli.

## Yang tidak bisa diklaim rantai

Tidak ada biaya terealisasi per panggilan di ledger — event biaya masuk ke
burn tracker. Rantai hanya memegang `budget_transition.spentUsd` (belanja
sejauh ini **di dalam jendela anggaran itu**, pada saat transisi) dan
`policy_decision.estimatedUsd` (perkiraan **pra-eksekusi** untuk tindakan
yang mungkin ditolak dan mungkin tak pernah berjalan).

Maka laporan ini tidak pernah mencetak "total belanja kemarin". Ia mencetak
puncak dan melabeli perkiraan sebagai perkiraan. Menjumlahkan field itu
menghasilkan angka yang percaya diri, salah, dan terekam permanen. Ada test
yang mencoba menjumlahkannya dan harus gagal.

## Dua temuan yang tak terlihat di tempat lain

**`approvals-expired`** — agent meminta izin, TTL habis, tidak ada manusia
yang datang. Bukan kegagalan teknis: masalah organisasi, dan pekerjaannya
berhenti diam-diam.

**`repeat-denials`** — agent sama ditolak untuk alat sama sembilan kali
hampir tidak pernah penyusup. Itu loop. Ambangnya 3, dan penolakan yang
tersebar ke alat berbeda **tidak** dijumlahkan jadi alarm palsu.

Membedakan agent mati dari agent menganggur hanya mungkin lewat periode
pembanding: keduanya menghasilkan nol event.

## Mutasi

| Mutasi | Test gagal |
|---|---|
| ambang penolakan 3→1 (alarm palsu) | 1 |
| hari sepi tak pernah sepi (padding) | 4 |
| status terakhir, bukan terburuk | 1 |
| belanja puncak → belanja terakhir | 1 |
| bagi nol pada hari pertama | 2 |
| urutan temuan ikut urutan kedatangan | 1 |
| peringkat keparahan dihapus | 1 |
| penolakan lintas-alat dijumlahkan | 3 |

Dua dari delapan mutasi itu awalnya **tidak membunuh apa pun**, dan keduanya
mengajarkan sesuatu:

*Menghapus `findings.sort()` tidak merusak satu test pun* — panggilan `add()`
kebetulan sudah berurutan keparahan, jadi sort-nya tidak terlihat. Sort yang
tidak terlihat adalah sort yang dihapus suntingan berikutnya. Diperbaiki
dengan mengekstraknya jadi `rankFindings()` yang diuji langsung dengan input
yang memang berantakan.

*Mutasi kunci penolakan tidak pernah berjalan* — python memakan `\u0000` di
string tiga-kutip, jadi "anchor hilang" terlihat seperti mutasi yang lolos.
Mutasi yang gagal dijalankan dan mutasi yang selamat terlihat sama persis
dari jauh.

## Satu bug test yang patut dicatat

Assertion `!/utuh/` gagal pada teks yang benar: "mem**butuh**kan" memuat
"utuh". Varian bahasa Indonesia dari jebakan `gpt-4o` di dalam `gpt-4o-mini`
yang sudah tercatat di fase-fase awal. Jangkarkan pada frasa utuh, bukan
kata.

## Baseline

**304 backend** · 119 frontend · lint bersih · build 216 kB · 5 skrip PASS
(41 klaim dokumen).


---

# Fase 15 — Utang kosmetik

Dua item yang menganggur sejak Fase 5. Keduanya ternyata menyembunyikan
sesuatu yang lebih besar daripada tampilannya.

## Enam dari tujuh `!important` dicabut

Semuanya tidak pernah diperlukan. `donghua.css` diimpor terakhir di
`HermesOfficeApp.tsx` dan selektornya persis sespesifik milik `office.css` —
urutan sumber saja sudah menang. Flag itu dipasang "untuk jaga-jaga".

Itu bukan sekadar kerapian. Lapisan tema yang berteriak `!important`
meninggalkan pelanggan yang me-reskin produk tanpa tempat eskalasi lagi,
yang persis meniadakan guna punya lapisan tema — dan "bisa di-skin" adalah
bagian dari apa yang dibayar pembeli $2.000.

Yang bertahan satu, sengaja: `transition: none` di dalam
`@media (prefers-reduced-motion: reduce)`. Beda jenis — jaminan
aksesibilitas, dan konvensinya memang membuatnya tak bisa ditimpa supaya
tidak ada aturan baru yang mengembalikan gerak bagi orang yang memintanya
berhenti. Mengejar angka nol di sini akan menukar aksesibilitas dengan
kerapian.

### Penjaganya: `frontend/src/styles/cascade.test.ts` (10 test)

Dua dokumen dibangun — satu tanpa lapisan tema, satu dengan — lalu properti
chrome tiap panel harus berubah. Batasnya dinyatakan terbuka di berkasnya:
jsdom tidak me-resolve `var()`, jadi test ini **tidak** memeriksa bahwa
panelnya berwarna benar, hanya bahwa tema masih sampai ke elemennya. Itu
klaim yang lebih lemah dan satu-satunya yang jujur — unit test tidak bisa
melihat.

Tiga hal yang ditemukan sambil membangunnya:

1. **Komentar baru saya sendiri merusak penghitungnya.** Penjelasan prosa
   tentang mengapa flag dicabut memuat kata `!important` dua kali, dan
   `check-docs.py` melaporkan 3 flag di berkas yang punya 1. Penghitung
   sekarang membuang komentar dulu — di test maupun di check-docs.
2. **`?raw` dikosongkan vitest.** CSS di-stub secara default, jadi impor
   mentah mengembalikan string kosong dan sepuluh test "lulus" atas berkas
   kosong. Diperbaiki dengan `css: true` di konfigurasi test.
3. **Satu asersi tak bisa diukur, jadi tidak dipura-purakan.** Aturan trim
   state memakai `color-mix()` atas token `var()`; jsdom mengevaluasi
   keduanya jadi kosong, sehingga elemen biasa dan elemen `hot` menghitung
   nilai yang sama dan test terukur akan lulus karena alasan yang salah.
   Diganti asersi struktural atas bentuk selektornya, dengan keterbatasan
   itu ditulis di tempatnya.

## Dinding magenta `mac-studio-day`

Plate sumber di `art-backup` abu-abu batu tulis rata — **magenta itu
sepenuhnya artefak pipeline restyle**, bukan seni aslinya. Terukur: dinding
185° (cyan) di kiri, 327° (magenta) di kanan.

Diperbaiki dengan filter, bukan regenerasi. Geometri plate itu
load-bearing: perabot dikomposit pada koordinat persentase, jadi plate baru
dengan meja bergeser dua persen diam-diam membuat setiap karakter yang
berdiri di situ salah tempat. Image-gen tidak bisa memegang tata letak
seketat itu; filter hue mengubah warna dan tidak ada yang lain.

### `scripts/recolor-wash.py` — dipersistensi, bukan heredoc

Menyingkap celah terpisah: restyle 18 plate ruangan dulu dikerjakan ad-hoc
dan **tidak pernah disimpan sebagai skrip**, jadi plate-plate itu tidak bisa
diregenerasi dari `art-backup`. Koreksi ini minimal reproducible, lengkap
dengan argumennya dicatat di `ASSET-MANIFEST.json`.

### Jaring saturasi adalah alat yang salah

Percobaan pertama melindungi prop berdasarkan saturasi. Hasilnya **kubus
merah berubah jadi cyan** (hue 13° → 187°) dan sisa magenta bersaturasi
tinggi tertinggal di dinding sebagai noda — sebelumnya ia menyatu dengan
dinding merah muda, setelah dikoreksi ia jadi noda mencolok di dinding
hijau. Itu mode kegagalan khas filter selektif: melindungi piksel justru
membuatnya lebih mencolok begitu sekelilingnya benar.

Pengukuran menunjukkan jawabannya: **tidak ada prop sah yang hidup di
290–350°.** Kubus ungu 266°, kubus merah 7,6°, dan monitor yang disangka
ungu ternyata biru 223°. Hue saja sudah memisahkan; jaring saturasi
dimatikan dan band dipersempit.

### Dua positif palsu yang hanya mata bisa tolak

Pemindaian seluruh plate menemukan dua lagi bersaturasi magenta tinggi:
`nap-wellness-room` (9,7%) dan `office-night-dm` (16,0%). Keduanya dibuka
dan **dibiarkan**: yang pertama suasana malam ungu yang disengaja, yang
kedua langit senja di balik jendela. Pemindai angka itu daftar pendek,
bukan vonis.

### Korban yang diterima

Grafik data magenta di layar monitor kanan ikut jadi hijau. Itu konten,
bukan pencahayaan — tapi magenta tidak ada di palet mana pun dan dua monitor
lainnya cyan. Dicatat di manifest, bukan disembunyikan.

## Baseline

304 backend · **129 frontend** (+10) · lint bersih · build 216 kB · 5 skrip
PASS (41 klaim) · `donghua.css` 176 baris, **1 `!important`**.


---

# Fase 16 — Paket penjualan

Produk ini punya empat artefak kuat dan nol materi yang menjelaskan mengapa
harganya $2.000. Fase ini menutup celah itu. Tidak ada kode server yang
berubah; `check-docs.py` **41 → 52 klaim**.

## `scripts/demo.sh` — satu perintah, 90 detik

Keempat artefak yang menjual produk ini — kiosk, standup, replay,
dossier — semuanya diturunkan dari ledger. Pada instalasi baru ledger itu
kosong, jadi keempatnya **dengan benar** merender "belum ada apa-apa". Demo
kantor kosong tidak mendemokan apa pun, dan yang memperagakan akhirnya
menarasikan seperti apa layar itu *seharusnya* — gerakan penjualan terburuk
yang ada.

Jadi skrip ini menyemai insiden yang spesifik dan terbaca: citra meminta
masuk ruang server dan keputusannya menunggu manusia, budi terjebak loop
retry melawan `kubectl` sembilan kali, belanja ana menembus anggaran per jam
sampai tripped. Itu cerita yang langsung dikenali setiap pembeli dari log
mereka sendiri.

Berjalan di direktori data buangan dan port non-default. Demo yang bisa
merusak bukti produksi bukan demo yang pantas dijalankan siapa pun.

Dua penjaga ditambahkan setelah menjalankannya sungguhan: `node_modules` dan
`frontend/dist` keduanya hilang di tengah turn ini (masing-masing untuk
ketiga dan kedua kalinya), dan tanpa penjaga itu skrip menyambut pembaca
dengan tumpukan `ERR_MODULE_NOT_FOUND`. Demo yang membuka dengan stack trace
sudah kalah sebelum mulai.

Setiap pemberhentian tur diverifikasi berjalan sungguhan, bukan diasumsikan:
`/` 200 · kiosk `tripped` dengan **0** tanda dolar dan `$2.25 / $2.00` saat
reveal · standup 3 temuan · replay 23 frame `peakBurn: tripped` · dossier 131
baris terverifikasi.

## `README.md` ditulis ulang

Yang lama adalah halaman status operasional yang diwarisi — ia bahkan
membocorkan URL Tailscale hidup milik pemilik asli dan membingkai repo
sebagai "dikelola oleh tim Niumination". Benar untuk deployment aslinya,
salah untuk produk yang dijual. Diarsipkan ke `docs/LEGACY-README.md`
daripada dibuang.

Yang baru memimpin dengan tiga angka dan satu tanggal: 96% perusahaan
melampaui proyeksi biaya AI dan hanya 44% punya pagar pengaman; tidak ada
framework agen besar yang mengirim pembatas dolar native (OWASP LLM10,
Denial of Wallet); kewajiban berisiko-tinggi EU AI Act berlaku sejak 2
Agustus 2026 dengan denda €15 juta atau 3%.

Bagian **"Apa yang TIDAK dilakukannya"** ditaruh di muka, bukan disembunyikan
di bawah. Tidak membaca isi prompt, tidak bersaing dengan Agent View vendor,
tidak per kursi, bukan SaaS multi-tenant, dan **tahan-rusak bukan
anti-rusak**. Untuk pembeli kepatuhan, kejujuran soal batas justru
diferensiasinya — siapa pun yang menjual "anti-rusak" sedang berbohong, dan
asesor tahu itu.

Tabel perbandingan menyebut pesaing dengan harga aslinya, termasuk yang jauh
lebih besar (Langfuse 35,4k★ di $2.499 Enterprise). README yang berpura-pura
tidak punya pesaing membuat pembaca berhenti memercayai sisanya.

## `docs/PRICING.md`

$0 / $39 Solo Pro / $299 Team / $2.000+ Enterprise. Lisensi abadi, bukan
langganan: pembeli ini tidak membeli layanan, mereka membeli kemampuan
membuktikan sesuatu nanti — dan artefak yang buktinya lenyap saat kartu
kredit kedaluwarsa bukan bukti.

**Flight recorder tetap di tingkat gratis.** Memindahkan integritas log ke
balik paywall berarti menjual keselamatan kepada yang paling mampu membayar,
dan membuat proyek ini kehilangan hak berargumen seperti yang ia lakukan di
`SECURITY.md`. Yang berbayar adalah lapisan artefak di atas rantai, tidak
satu pun diperlukan agar rantai itu benar.

## Dokumen penjualan ikut dipagari mesin

Dokumen yang paling mungkin melenceng dan paling merusak saat salah justru
yang terakhir masuk pemeriksa. Setiap dokumen lain membusuk hanya
memalukan developer; dua ini menyesatkan pembeli.

Sebelas klaim baru: jumlah test ditanyakan ke runner-nya, perintah
quickstart harus menunjuk skrip yang ada, keempat tingkat harga harus sama
di README dan PRICING, dan tiga janji — privasi prompt, tanpa-per-kursi,
tahan-rusak — harus masih tertulis.

Klaim ke-52 memeriksa dirinya sendiri: jumlah klaim yang dikutip README
harus sama dengan jumlah yang benar-benar diperiksa run itu, dihitung
terakhir dan menghitung dirinya sendiri. Itu satu-satunya angka yang dijamin
busuk, karena setiap pemeriksa baru membatalkannya.

## Mutasi

| Mutasi di README | Terdeteksi |
|---|---|
| jumlah test backend dipalsukan | ✅ |
| quickstart menunjuk skrip yang tak ada | ✅ |
| janji privasi prompt dihapus | ✅ |
| tahan-rusak dinaikkan jadi anti-rusak | ✅ |
| harga berbeda dari PRICING.md | ✅ |
| komitmen tanpa-per-kursi dicabut | ✅ |

Mutasi harga awalnya terbaca "lolos". Ia tidak lolos — pola `sed`-nya tidak
cocok apa pun, jadi mutasinya tidak pernah terpasang. Persis kegagalan yang
sama dengan mutasi `\u0000` di Fase 14, dua fase berturut-turut: **mutasi
yang gagal dijalankan dan mutasi yang selamat terlihat identik.** Selalu
pastikan mutasinya benar-benar masuk sebelum memercayai hasilnya.

## Baseline

304 backend · 129 frontend · lint bersih · build 216 kB · 5 skrip PASS ·
**52 klaim dokumen**.


---

# Fase 17 — Dua bahasa

`README.md` dan `docs/PRICING.md` kini berbahasa Inggris sebagai versi utama;
versi Indonesia dipertahankan berdampingan sebagai `README.id.md` dan
`docs/PRICING.id.md`, dengan penukar bahasa di kepala masing-masing. Pembeli
$2.000 untuk alat kepatuhan EU AI Act kemungkinan besar bukan penutur
Indonesia; dokumen internal tetap Indonesia.

## Terjemahan adalah tempat kedua bagi klaim untuk membusuk

Dan ia membusuk lebih diam-diam daripada aslinya, karena yang menyunting
versi Inggris sering tidak bisa membaca yang satunya. Maka pemeriksa
dokumen diperluas jadi **pemeriksa paritas**: kedua versi harus menyebut
harga yang sama, jumlah test yang sama, dan masih memuat janji yang sama.
Kata-katanya bebas; komitmennya tidak.

Yang dijaga: tiga janji (privasi prompt, tanpa-per-kursi, tahan-rusak) di
kedua bahasa · jumlah test ditanyakan ke runner dan harus cocok di keduanya ·
perintah quickstart harus menunjuk skrip yang ada · penukar bahasa harus
hidup di keempat berkas · baris tabel harga harus menyebut keempat tingkat.

## Tiga cacat di alat saya sendiri

**1. Klaim mandiri memberi angka berbeda di tiap bahasa.** Setiap klaim
menaikkan hitungan saat diperiksa, jadi berkas Inggris menuntut 70 dan yang
Indonesia 71. Angka yang benar di satu berkas dan salah di berkas lain tidak
layak dicetak. Diperbaiki: semua klaim-mandiri dihitung dulu, baru
dibandingkan terhadap total akhir yang sama.

**2. Pemeriksa melaporkan "dokumen berbohong" padahal test yang gagal.**
Suite yang gagal menurunkan jumlah `# pass`, dan pemeriksa menyimpulkan
README salah — mengirim pembaca menyunting angka padahal masalahnya test
rusak. Ia menyesatkan penulis fungsi itu sendiri, yang persis bagaimana
perbaikannya ditulis: sekarang ia membaca `# fail` dulu dan berkata *"perbaiki
test-nya, bukan README-nya"*.

**3. Pemeriksa harga hijau di atas tabel harga yang salah.** Versi pertama
mencari tiap tingkat di **mana saja** dalam dokumen. Ia meloloskan tabel yang
sudah dimutasi ke $2.400 karena angka $2.000 yang benar masih muncul dua
paragraf kemudian di prosa. Pemeriksa hijau di atas dokumen yang mengutip
harga salah lebih buruk daripada tidak punya pemeriksa. Sekarang ia menuntut
**satu baris tabel** yang memuat keempat tingkat sekaligus.

Cacat ketiga ditemukan hanya karena mutasi kelima awalnya terbaca kosong —
dan menyelidikinya mengungkap dua hal sekaligus: mutasi itu sebenarnya
terpasang (backup saya salah berkas, jadi `PRICING.md` tertinggal rusak), dan
pemeriksanya memang tidak melihatnya.

## Mutasi

| Mutasi | Terdeteksi |
|---|---|
| terjemahan ID diam-diam mencabut tanpa-per-kursi | ✅ |
| terjemahan ID menaikkan jadi anti-rusak | ✅ |
| harga ID menyimpang dari EN | ✅ |
| jumlah test ID tertinggal dari EN | ✅ |
| penukar bahasa mati | ✅ |
| tabel harga PRICING EN menyimpang | ✅ |
| jumlah test backend dipalsukan | ✅ |
| quickstart menunjuk skrip yang tak ada | ✅ |

Dua di antaranya awalnya terbaca "lolos" dan keduanya ternyata **tidak pernah
terpasang** — nomor baris bergeser dua karena penukar bahasa, dan satu berkas
tidak masuk daftar backup. Itu kejadian ketiga berturut-turut dalam tiga fase.
Pola tetapnya: **selalu tegaskan mutasinya benar-benar masuk sebelum
memercayai hasilnya**, dan di sini itu langsung berbuah — memeriksanya
menemukan cacat nyata ketiga di atas.

## Baseline

304 backend · 129 frontend · lint bersih · 5 skrip PASS · **61 klaim
dokumen** (turun dari 73: pemeriksa harga yang diperkuat menggantikan 16
pemeriksaan presence-anywhere yang lemah dengan 4 pemeriksaan baris-tabel
yang kuat).

## Fase 18 — Plate ruangan: integritas, provenance, penerimaan

Fase ini dimulai dari diagnosis saya sendiri yang salah, dan hampir seluruh
nilainya datang dari membatalkannya.

### Dua klaim yang salah

Saya menutup Fase 17 dengan menawarkan "celah reproduksibilitas": 18 plate
ruangan tidak bisa diregenerasi dari `art-backup/` karena pipeline restyle-nya
tak pernah disimpan sebagai skrip. Rencananya menulis ulang pipeline itu.

Membuka berkasnya membatalkan rencana tersebut. `art-backup/rooms/meeting-room.webp`
adalah persegi panjang datar bertuliskan **"MEETING ROOM / PLACEHOLDER ART"**.
Dua belas dari enam belas berkas backup seperti itu: 64–377 warna unik pada
sampel 60x45, melawan 1711+ untuk setiap plate asli. Hanya empat berkas
`office-*` yang seni upstream sungguhan. Dua plate (`office-day-dm`,
`office-night-dm`) tidak punya sumber sama sekali.

Jadi dua klaim lama di repo ini keduanya salah:

1. *"`art-backup/rooms/` adalah asli murni, jangan pernah ditimpa"* — benar
   untuk 4 berkas, salah untuk 12.
2. *"pipeline-nya hilang dan harus ditulis ulang"* — tidak ada pipeline.
   Tidak ada filter yang bisa menghasilkan plate ini dari placeholder itu.
   Seninya dihasilkan, bukan diturunkan.

Keduanya hanya terbongkar dengan melihat pikselnya. Keduanya sempat saya
tulis dengan percaya diri. Pola yang sama berulang di proyek ini: klaim
tentang aset yang tidak pernah dieksekusi apa pun.

### Tujuan yang benar

Karena generasi tidak deterministik, "buat ia reproducible" bukan tujuan yang
bisa dicapai. Yang bisa:

> Anda tidak bisa mereproduksi seni yang dihasilkan.
> Anda bisa mereproduksi penilaian apakah sebuah plate pantas masuk.

### `scripts/check-plates.py`

`check-assets.sh` hanya memastikan ada berkas dengan nama yang benar. Plate
yang terpotong nol byte, tertukar dengan ruangan lain, atau diam-diam
di-reencode setengah resolusi semuanya lolos — dan dua plate memang pernah
hilang di proyek ini tanpa ada yang sadar. Karena seninya tidak bisa
diregenerasi, bytenya **adalah** master copy, dan hash adalah satu-satunya
yang menjaganya.

`frontend/public/rooms/PLATES.json` mencatat sha256, origin (upstream atau
generated), dan statistik palet untuk 18 plate. Tujuh aturan penerimaan,
semuanya diukur dari korpus yang ada lalu dilonggarkan ke angka bulat:

| Aturan | Batas | Menangkap |
|---|---|---|
| Kanvas | 1600x1200 untuk ruangan baru | geometri salah |
| Berkas | 40-320 kB | terpotong / jauh lebih berat |
| Warna unik @60x45 | >= 900 | **seni placeholder** |
| Luminansi rata-rata | 0,18-0,62 | terlalu gelap / terlalu terang |
| Persentil-5 | <= 0,32 | tak ada yang gelap di frame |
| Persentil-95 | >= 0,45 | tak ada yang tersinari |
| Off-palette magenta | > 3% wajib ditinjau | siraman nyasar |

Ambang warna unik duduk di celah lebar antara dua populasi: placeholder
berhenti di 377, plate asli mulai di 1711.

### Off-palette ditandai, bukan ditolak

Memfailkan >3% magenta akan menolak `nap-wellness-room` (12,2%) dan
`office-night-dm` (17,7%) — dan keduanya benar: suasana malam ungu yang
disengaja, dan langit senja di balik jendela. Jadi konten off-palette menuntut
catatan `offPaletteReviewed` eksplisit, bukan diloloskan diam-diam dan bukan
ditolak diam-diam. Pemindai adalah daftar pendek; manusia adalah vonisnya.

`check-docs.py` kini menuntut setiap pengecualian yang ditinjau **disebut
namanya di prosa**. Pembebasan tanpa penjelasan di manifest adalah cara cacat
sungguhan diselundupkan masuk.

### Mutasi

Tujuh mutasi integritas, semuanya tertangkap. Tapi lima di antaranya
tertangkap oleh hash, yang memutus sebelum pemeriksaan gaya sempat jalan —
artinya aturan placeholder, luminansi, dan p5/p95 masih belum terbukti bisa
menyala sama sekali. Kasus sintetis yang mengisolasi tiap aturan dibuat untuk
memaksanya: derau dua-warna frekuensi tinggi (berkas besar, 42 warna unik),
dan dua gambar yang luminansi rata-ratanya sah tapi rentangnya rata. Sepuluh
aturan, sepuluh terbukti menyala. Tiga mutasi lagi untuk pemeriksa dokumen
baru: ambang digeser di checker tanpa prosa ikut, plate dihapus dari manifest,
pengecualian tak lagi dijelaskan.

### CI yang merah sejak hari pertama

Baseline yang saya laporkan hijau selama beberapa fase ternyata hijau karena
alasan yang salah. `tests/integration.test.js` menegaskan rute SPA menjawab
200, yang hanya benar bila `frontend/dist/index.html` ada. Tapi `dist/`
di-gitignore dan job backend di CI tidak pernah membangun frontend. Test itu
**gagal 100% pada setiap clone bersih dan setiap run CI**; ia lolos di sini
semata-mata karena ada build basi tertinggal di sandbox.

Bentuk kegagalannya memperburuk: assertion-nya berbunyi `404 !== 200`, yang
menyalahkan rute alih-alih menyebut build yang hilang.

Kontrak yang diuji adalah soal routing, bukan soal bundle sungguhan. Jadi
suite kini menyediakan `index.html` stub bila tidak ada build, dan menghapus
hanya apa yang ia buat — pembersihannya ditaruh di atas `return` dini di
`after()`, karena stub yang tertinggal akan membuat clone berikutnya lolos
untuk alasan yang salah, persis kegagalan yang sedang diperbaiki.

Diverifikasi di kedua dunia: 304 lulus dengan build nyata, 304 lulus tanpa
`frontend/dist` sama sekali.

### Status

`check-plates.py` menjadi gerbang ke-6 di `ci/workflow.yml`; menghapus
langkahnya terdeteksi oleh `check-ci.sh`. Klaim dokumen 61 -> 71.

304 backend - 129 frontend - lint bersih - 6 skrip PASS - 18 plate - 71 klaim.

## Fase 19 — Sprite: reproduksi sungguhan, dan dua hal yang ditemukan di jalan

Fase 18 menutup dengan tawaran: sprite punya sumber asli sungguhan, jadi di
sana pemeriksaan bisa lebih kuat daripada di plate. Fase ini mengeksekusi
klaim itu sebelum membangun apa pun di atasnya — persis kesalahan yang baru
saja menjebak saya satu fase sebelumnya.

Klaimnya **40% benar**. Dari 250 sprite yang dikirim, hanya 100 punya
original. 150 tidak punya sumber sama sekali.

### Jaminan yang plate tidak bisa punya

Untuk 100 yang bersumber, jaminannya naik satu tingkat dari sidik jari
menjadi reproduksi:

> Bangun ulang dari sumber, dan hasilnya harus cocok byte-for-byte.

`check-sprites.py --regen` membangun ulang seluruh 100 dari
`art/originals/sprites` lewat `stylize-donghua.py` dan menuntut kecocokan
byte. Hasilnya: **100/100 identik**. Itu satu-satunya hal yang bisa menangkap
konstanta filter yang bergeser, karena saat itu setiap berkas di disk masih
cocok dengan hash-nya. Dibuktikan: menggeser `RIM_STRENGTH` dari 0,55 ke 0,56
membuat jalur cepat tetap hijau dan `--regen` melaporkan 100 dari 100 gagal.

### Cacat yang menghancurkan seni pelanggan

`stylize-donghua.py` menyimpan pohon originalnya di `/home/user/art-backup/sprites`
— path absolut yang ada di tepat satu mesin dan di nol clone repo ini.

Di mesin lain alurnya: path tidak ada → skrip memperlakukan sprite yang
**sudah ber-filter** sebagai original murni → menyalinnya ke pohon original →
menerapkan filter kedua kali → menimpa seninya. Original sejatinya hilang,
hasil rusaknya terdaftar sebagai sumber kebenaran, dan skripnya mencetak
`originals preserved` sambil melakukannya.

Ini tidak disimpulkan, tapi dijalankan: sebagai pelanggan, 250 sprite rusak,
tidak bisa dipulihkan, tanpa satu pun peringatan. Ini cacat terburuk yang
ditemukan di proyek ini — diam, permanen, dan skripnya aktif berbohong.

Perbaikannya: original dibawa masuk ke repo (`art/originals/sprites`, 13 MB),
original yang hilang jadi penghentian keras, dan mengadopsi berkas sebagai
originalnya sendiri butuh `--adopt` eksplisit yang dihitung di output.
Diverifikasi: seni pelanggan tetap utuh, exit 1, pesan yang menyebut
sebabnya.

Satu catatan jujur: hasil "100/100 identik" saya yang pertama lebih lemah
dari kelihatannya, karena skripnya membaca dari path absolut itu, bukan dari
SRC yang saya berikan. Angkanya benar, alasannya bukan yang saya kira.

### Fitur visual utama tidak pernah menyentuh castnya

150 sprite tanpa sumber itu bukan selisih pembulatan. Mereka adalah **setiap
karakter di aplikasi** — 108 di `office/characters`, 42 di `characters/`.

Docstring `stylize-donghua.py` membuka dengan kalimat bahwa ia menata "108
sprites: 27 characters x 4 facings". `office/characters` memuat tepat 108
berkas. Tidak satu pun pernah melewati filter.

Buktinya struktural, bukan penilaian mata: pipeline menyalin setiap berkas
yang disentuhnya ke pohon original sebelum menyentuhnya, dan pohon itu tidak
memuat satu pun karakter. Seluruh pass donghua — rim light, ambient
occlusion, specular, grade hangat, keyline — mendarat di properti, kucing,
efek, furnitur, dan dekorasi.

Saya sempat mencoba membuktikannya lewat metrik kecerahan tepi siluet.
Metriknya lemah dan tidak konklusif (Δ +0,031, rentang bertumpang tindih),
jadi tidak dipakai. Catatan cadangan sudah rapat sendiri.

Memperbaikinya keputusan seni, bukan teknis: ia mengubah tampilan setiap
karakter di produk. Jalurnya siap, manifestnya tidak berpura-pura celah itu
tidak ada, dan `check-docs.py` akan gagal kalau prosanya nanti hidup lebih
lama dari kebenarannya.

### CI merah lagi, kali ini buatan saya

Gerbang `check-plates.py` yang saya tambahkan di Fase 18 butuh Pillow, dan
workflow tidak pernah memasangnya. Gerbang itu akan `ModuleNotFoundError` di
runner bersih — kelas kesalahan yang sama persis dengan bug `dist` yang baru
saja saya perbaiki, diulangi satu fase kemudian. `setup-python` + `pip install
pillow` kini ada di workflow.

`check-sprites.py` juga berperilaku buruk tanpa Pillow: probe alpha-nya
melempar, `classify()` menelannya, dan 100 sprite dilaporkan sebagai
provenance drift — seratus kegagalan membingungkan alih-alih satu baris yang
bisa ditindak.

### Celah di pemeriksa saya sendiri

`originalSha256` sudah direkam tapi tidak pernah dibandingkan di jalur cepat.
Original yang dirusak diam-diam lolos, dan hanya terdeteksi setelah dua menit
membangun ulang. Hash-nya sudah ada; membandingkannya gratis. Sekarang
tertangkap dalam milidetik.

### Mutasi

Delapan mutasi aset, semuanya tertangkap: sprite hilang, tak terdaftar,
terpotong, tertukar, original hilang, original dirusak, konstanta filter
bergeser, plus sprite baru tanpa pendaftaran. Tiga mutasi dokumen: path
`/home/user` kembali ke pipeline, prosa berhenti menyebut 150, karakter
diam-diam diberi provenance `derived`.

Yang kedua gagal terpasang pada percobaan pertama — `sed`-nya meleset dan
"150" masih muncul di tempat lain, jadi hijaunya benar. Keempat kalinya pola
ini muncul di proyek ini. Diulang dengan `grep` membuktikan nol sebutan
tersisa, lalu menyala.

### Status

`check-sprites.py --regen` jadi gerbang ke-7 di CI; menghapus langkahnya
terdeteksi `check-ci.sh`. Klaim dokumen 71 -> 79.

304 backend - 129 frontend - lint bersih - 7 gerbang PASS - 18 plate -
250 sprite (100 reproducible) - 79 klaim.

---

## Fase 19 — Banding sprite: hipotesis yang terbantah, keberatan yang tidak

Fase pendek dengan dua temuan yang berlawanan arah: satu keluhan teknis yang
ternyata salah, dan satu keluhan estetika yang ternyata benar.

### Hipotesis yang diukur sampai mati

Keluhannya: filter donghua merusak tepi pixel art. Itu klaim yang bisa
diukur, jadi diukur. Hitung piksel semi-transparan (alpha di antara 0 dan
255) sebelum dan sesudah filter, di seluruh 100 sprite derived:

```
sebelum: 5812    sesudah: 5812
```

Identik. Filter alpha-aware itu memang tidak menyentuh tepi. Hipotesisnya
terbantah, dan tidak dengan pendapat — dengan satu angka yang sama dua kali.

### Keberatan yang bertahan

Yang tersisa setelah angka itu bukan kerusakan tepi, melainkan `RIM_STRENGTH
= 0.55`. Nilai itu disetel sambil melihat prop — kursi, tanaman, monitor —
di mana rim cyan membaca sebagai pantulan cahaya ruangan. Pada wajah, pada
zoom 1:1, nilai yang sama membaca sebagai halo. Tidak ada yang rusak. Ia
hanya disetel untuk subjek yang salah, lalu diterapkan ke semua subjek.

Perbedaan itu penting untuk dicatat, karena dua keluhan terdengar sama saat
diucapkan ("sprite-nya jelek setelah difilter") dan butuh dua respons yang
sepenuhnya berbeda. Yang pertama dijawab dengan pengukuran. Yang kedua tidak
bisa dijawab dengan pengukuran sama sekali.

Banding disusun di `sprite-banding.png` dan diserahkan ke mata, bukan ke
skrip.

### Vonis

Vonis pengguna: **tolak seluruh pendekatan filter.** Bukan setel ulang
`RIM_STRENGTH`, bukan kecualikan karakter dari pass rim — buang premisnya.
Itu menutup Fase 19 tanpa satu baris kode pun berubah, dan membuka Fase 20
dengan masalah yang jauh lebih besar: kalau castnya tidak boleh difilter,
castnya harus diganti.

---

## Fase 20 — Cast donghua: delapan arketipe, dan kategori provenance ketiga

Permintaannya: *"ini masih jauh dari karakter donghua, coba riset lagi main
character dari seri seri donghua populer saat ini. dan ubah karakternya."*
Jadi riset dulu, baru gambar.

### Riset: apa yang sebenarnya dilihat orang di 2026

Lintas peringkat (chineseanimetop, topani, r/Donghua, newhanfu), puncaknya
konsisten: **Lord of Mysteries** (steampunk okultis Victoria, 22 Sequence),
**Renegade Immortal** (Wang Lin, protagonis bermoral gelap), **To Be Hero X**
(hibrida 2D/3D, sutradara berbeda tiap episode), **Link Click**, **Mo Dao Zu
Shi**, **Heaven Official's Blessing**. Lapis arus utamanya tetap kultivasi:
Battle Through the Heavens, Perfect World, Swallowed Star, Soul Land.

Yang berguna bukan daftar judulnya, melainkan satu pola tata busana xianxia
yang bisa dipetakan langsung ke produk ini: **tangga kultivasi adalah tangga
kostum.** Mortal memakai potongan lurus, lengan sempit, warna tanah.
Foundation menambah lapisan dan bordir halus. Golden Core memakai jubah
mengalir dan sutra. Nascent Soul memakai lapisan tembus pandang dan gradien.
Itu kosakata senioritas yang sudah jadi, dan kantor agen punya senioritas.

### Pengujian yang membatalkan desain pertama

Render pertama adalah kultivator berjubah giok dengan proporsi ilustrasi
penuh, 1024 px, dan ia indah. Lalu ia dikecilkan ke ukuran render sebenarnya
— 78 px — dan dikomposit di atas `meeting-room.webp`.

Ia jadi noda abu-abu. Wajah hilang, jubah menyatu, kontrasnya kalah dari
pixel art lama yang ia gantikan. Zoom 4× nearest-neighbour memastikan tidak
ada yang bisa diselamatkan dengan sharpening: informasinya tidak ada di sana.

Perbaikannya bukan filter, melainkan **proporsi**. Q版 (chibi), kepala ≈ 1/3
tinggi — konvensi asli Tiongkok untuk karakter kecil, dipakai justru karena
alasan ini. Uji ulang pada 78 px: wajah, mata, tanda giok, dan trim emas
semuanya tetap terbaca.

Dua render, satu keputusan desain, nol perdebatan selera. Bukti tersimpan
sebagai `donghua-uji-78px.png` (gagal) dan `donghua-uji-chibi.png` (lulus).

### Delapan arketipe, bukan 27 karakter

Pilihan pengguna: roster **arketipe peran**, bukan salinan 1:1 cast lama,
dan tinggi render naik **78 → 96 px** (boss 85 → 104) untuk membayar detail
yang baru saja terbukti bertahan.

| Arketipe | Peran repo | Tanda baca visual |
|---|---|---|
| `cultivator` | fullstack / default | giok + emas |
| `weaver` | frontend | biru langit + pink, side-ponytail berpita |
| `forge` | devops | oranye bakar + perunggu, palu di bahu |
| `guardian` | security | merah tua + hitam + emas, pedang giok |
| `scholar` | reviewer | putih bulan + indigo, gulungan |
| `alchemist` | tester | saffron + teal, twin buns + labu |
| `physician` | debugger | mint + putih, kepang samping |
| `elder` | manager / boss | ungu kekaisaran + perak, topknot bermahkota |

36 peran dipetakan ke 8 arketipe lewat `ROLE_TO_ARCHETYPE`, dengan
`archetypeFor()` jatuh ke `cultivator` untuk peran tak dikenal. Peran baru
tidak pernah merender kotak kosong.

### Tiga jebakan produksi

**Latar tidak boleh dipotong dengan color key.** Mengetangkan semua piksel
dekat warna latar juga melubangi sabuk dan jubah abu-abu di tengah tubuh.
`cutout-cast.py` memakai **flood fill dari tepi**: latar terhubung ke tepi
kanvas, karakter tidak.

**Empat arah tidak boleh jadi empat generasi.** Identitas melayang; wajahnya
berubah saat ia berbalik. Pola yang dipakai: hasilkan **depan + belakang**,
cerminkan untuk kiri/kanan. Ongkosnya nyata dan dicatat di docstring —
atribut asimetris bertukar sisi (kepang `physician`, palu `forge`) — dan
tidak terlihat pada 96 px. Itu pertukaran yang diterima sadar, bukan yang
tidak disadari.

**Pemeriksa tidak boleh menulis ke direktori yang diperiksanya.**
`build-cast-sprites.py` semula menulis tetap ke `frontend/public/sprites/
donghua/`; memanggilnya dari verifier akan menimpa seni yang sedang
diperiksa dengan hasil builder yang mungkin rusak — verifikasi yang
menghancurkan buktinya sendiri. Diperbaiki dengan `--out DIR`. Setiap
builder yang dipakai verifier wajib bisa menulis ke scratch.

### Kategori provenance ketiga: `built`

32 sprite baru awalnya terhitung `unsourced`, dan itu meremehkan repo:
mereka **bisa** dibangun ulang dari `art/donghua-cast/` lewat resize +
cermin, keduanya deterministik. Tapi mereka juga bukan `derived`, karena
sumbernya adalah render yang dihasilkan, bukan seni yang digambar.

Jadi `check-sprites.py` sekarang punya empat kategori:

| | jumlah | bisa dibangun ulang dari |
|---|---|---|
| `derived` | 100 | original manusia di `art/originals/sprites/` |
| `built` | 32 | 16 render di `art/donghua-cast/` |
| `opaque` | 0 | — |
| `unsourced` | 150 | tidak ada |

Perbedaan `derived` vs `built` bukan birokrasi. Reproducibility cast
berhenti satu lapis lebih awal: 32 sprite terbukti berasal dari 16 render,
tapi 16 render itu sendiri hanya dilindungi hash, persis seperti plate
ruangan. Manifest menyatakan persis sejauh mana jaminannya berlaku.

`--regen` kini membangun ulang 132 sprite, ~2,5 menit, byte-exact.

### Mutasi

Tiga mutasi untuk kategori baru, dan yang ketiga adalah alasan kategori itu
ada:

| Mutasi | Jalur cepat | `--regen` |
|---|---|---|
| render cast dirusak (brightness 1,3×) | ✅ | ✅ |
| render cast dihapus (built → unsourced) | ✅ | ✅ |
| **pencerminan dibalik di builder** | ❌ | ✅ |

Yang ketiga tidak mengubah satu byte pun di disk. Semua 282 hash tetap
cocok, jalur cepat lulus dengan tenang, dan kerusakannya baru muncul saat
seseorang menjalankan ulang builder berbulan-bulan kemudian — 8 karakter
menghadap arah yang salah, tanpa satu pun commit yang menyentuh seni.

Hash menjaga **artefak**. `--regen` menjaga **resep**. Dokumen ini membuat
klaim kedua, jadi gerbang kedua harus ada.

Empat mutasi dokumen. Dua menyala langsung. Satu — menghapus `32` dari tabel
provenance — **tidak**, karena pemeriksanya `if claimed not in sd`, substring
telanjang yang tetap cocok dengan `132` di kalimat lain. Diperbaiki dengan
mengikat klaim ke baris tabelnya (`\| \`built\` \| 32 \|`), lalu menyala.
Kelima kalinya pola ini muncul di proyek ini: pemeriksa yang hijau karena
kebetulan, bukan karena benar.

### Dua catatan jujur yang menggantikan satu yang lama

`docs/SPRITES.md` dulu memuat "catatan jujur yang belum beres" tentang 20
sprite cast yang salah label. Itu sudah diperbaiki, jadi catatannya dihapus.
Dua yang menggantikannya lebih tidak nyaman:

1. **150 sprite cast lama tidak dirender oleh apa pun.** `grep` ke
   `frontend/src` mengembalikan nol rujukan ke `office/characters` maupun
   `characters/`. Mereka tetap dikirim sebagai bobot mati, sengaja: swap
   kembali adalah satu path di `Character.tsx`. Pemeriksa baru menegakkan
   prosa itu dua arah — kalau ada yang menyambungkan app ke cast lama,
   `check-docs.py` gagal.
2. **Liabilitas HKI.** 108 sprite `office/characters` adalah rupa yang dapat
   dikenali dari sebuah serial televisi, di dalam produk berharga $2.000+.
   Cast orisinal ini ada sebagian besar untuk alasan itu. Menghapus
   direktori lama menutup paparannya; menyimpannya menjaga jalur mundur.
   Itu keputusan komersial, dan belum diambil.

### Catatan operasional

Lima kali dalam fase ini snapshot workspace kehilangan direktori besar:
`node_modules` ×2, 36 original ×2, workflow CI ×1, dan 8 render PNG ~25 MB
yang hilang permanen. Mitigasinya: semua render kerja disimpan sebagai webp
256 px (`art/donghua-cast` 31 MB → 384 kB; repo 48M → 36M), dan render baru
ditulis di luar repo lalu diperkecil masuk dalam perintah yang sama.

`SPRITES.json` sendiri sempat ter-revert ke versi 250-entri setelahnya.
`check-sprites.py` menangkapnya pada detik pertama fase berikutnya. Aset
boleh hilang; yang tidak boleh adalah hilang diam-diam.

### Status

Dokumen disinkronkan 270 → 282 di ARCHITECTURE, PRD, UI-SPEC, dan kedua
README. Dua klaim basi ikut diperbaiki: ARCHITECTURE masih menulis pipeline
membaca dari `art-backup/` (sudah lama pindah ke `art/originals/sprites/`),
dan UI-SPEC masih melarang image-gen untuk karakter secara mutlak padahal
fase ini melakukannya — larangannya dipersempit ke bentuk yang sebenarnya
berbahaya, yaitu empat generasi terpisah per karakter.

Klaim dokumen 79 -> 83.

304 backend - 129 frontend - lint bersih - 7 gerbang PASS - 18 plate -
282 sprite (132 reproducible) - 83 klaim.

---

## Fase 21 — Dua tes yang gagal pada jam, dan pemeriksa yang bisa menguap

Fase ini tidak direncanakan. Ia dimulai dari satu baris aneh di keluaran
`check-docs.py` — `backend suite has 1 failing test(s)` — pada larian yang
diulang dan langsung hijau lagi.

### Hal yang paling mudah diabaikan

Larian berikutnya hijau. Larian setelahnya hijau. Godaannya jelas: catat
"flaky", lanjutkan. Dalam produk yang dijual $2.000+ itu pilihan yang mahal,
karena suite yang kadang merah mengajari orang menekan *re-run* sampai hijau
— dan itu persis kebiasaan yang membuat kegagalan sungguhan ikut lolos.

Jadi dihitung, bukan ditebak: 6 larian penuh, 1 gagal.

### Flake #1 — redaksi yang gagal karena jam dinding

`tests/kiosk.test.js` menyapu **seluruh** dokumen untuk substring terlarang.
Itu keputusan yang benar: assertion per-field akan melewatkan kebocoran lewat
atribut `title`. Tapi `renderKiosk` juga menanam `Date.now()` ke halaman
sebagai `data-at`, supaya browser bisa menunjukkan seberapa basi layar
dinding itu. Itu juga benar.

Keduanya bertabrakan. Epoch 13 digit memuat deretan 3 digit sembarang, dan
salah satu needle redaksi adalah `412` — angka telanjang. Diukur dengan
200.000 render acak: **0,81% tabrakan.**

Yang membuatnya jahat bukan probabilitasnya, melainkan **distribusinya**.
Epoch bergerak monoton, jadi kegagalannya tidak tersebar acak — ia
mengelompok. Dipetakan ke depan dari jam saat itu:

```
MERAH 04:46:52 selama 1s   (epoch 1791348412106)
MERAH 05:03:32 selama 1s
MERAH 05:20:12 selama 1s
total ≈ 20 menit merah per hari, jendela 1 detik tiap ~16,7 menit
```

Di dalam jendela itu, tes gagal untuk **semua orang**, dan sembuh sendiri
sebelum siapa pun sempat menyelidiki. Tes yang dijalankan sendirian: 12
larian, nol gagal. Flake yang menghilang justru ketika Anda mengisolasinya
untuk memahaminya.

Perbaikannya memasang jam ke konstanta — tapi memasangnya saja hanya
memindahkan bom ke orang berikutnya yang mengganti konstanta itu. Jadi
fixture-nya memeriksa dirinya sendiri:

```js
const NOW = 1700000000000;
const REDACTED_NEEDLES = ["412"];

test("the pinned clock cannot collide with a redaction needle", () => { ... });
```

Diuji dua arah: pasang `NOW` ke epoch beracun → menyala **dan menamai
sebabnya**. Sebelumnya yang terlihat hanya `reveal never exposes day or
lifetime spend` gagal — tuduhan palsu terhadap kode redaksi yang
sebenarnya tidak bersalah.

### Flake #2 — repetisi yang diukur dengan stopwatch

`tests/anchor.test.js` menjalankan timer 10 ms, tidur **tepat 45 ms**, lalu
menuntut ≥ 2 anchor. `node --test` menjalankan berkas tes secara paralel,
jadi di bawah beban timer-nya kelaparan dan dua tick tidak muat.

Ini juga tak pernah gagal sendirian. Supaya bisa diperbaiki, flake-nya harus
bisa dipanggil sesuka hati — jadi dibuat alat: jenuhkan semua inti CPU, lalu
jalankan.

```
versi lama, 2 inti jenuh:   gagal 9 / 10
versi baru, beban sama:     gagal 0 / 10
```

Perbaikannya memisahkan dua klaim yang arah waktunya berlawanan.
*"Ia berulang"* tidak butuh jam presisi, hanya tenggat longgar — itu jadi
polling. *"Ia berhenti setelah `stop()`"* justru **benar** memakai tidur
tetap: menunggu lebih lama hanya membuat assertion lebih sulit lulus, tidak
pernah lebih mudah. Beban tidak bisa memalsukan kelulusan.

Aturan itu yang ditulis di komentar, bukan "ganti semua sleep jadi poll".
Delapan tidur tetap lain di `integration.test.js` sengaja dibiarkan: mereka
bertahan 5 larian suite penuh dengan CPU jenuh total, jadi mengubahnya berarti
mengambil risiko tanpa bukti yang menuntutnya.

Suite penuh, 5 larian, 2 inti jenuh: **305 lulus, 0 gagal.**

### Pemeriksa yang bisa menguap, disapu habis

Fase 20 menemukan satu `if m:` di `check-docs.py` yang berhenti cocok setelah
prosa diubah — pemeriksanya mati tanpa satu pun kegagalan. Yang diperbaiki
saat itu hanya satu. Sisanya masih ada: sepuluh `re.search` opsional dan
empat `re.findall` yang, kalau tabelnya dihapus, cukup tidak melakukan apa-apa.

Keduanya sekarang lewat helper yang membuat *tidak cocok* menjadi kegagalan
bernama:

```python
def want(label, pattern, haystack, where):      # pola tunggal wajib cocok
def want_all(label, pattern, haystack, where, minimum):   # tabel wajib punya N baris
```

Lubang terdalamnya ada di backstop itu sendiri. `check-docs.py` memverifikasi
bahwa jumlah klaim yang dijalankan sama dengan angka yang dikutip README —
itulah yang menangkap pemeriksa yang hilang. Tapi kalau **kedua** README
kehilangan baris tabelnya, `found` kosong, loop perbandingan tidak melakukan
apa-apa, dan larian yang kekurangan pemeriksa mencetak PASS. Penjaga yang
bisa dibunuh dengan menghapus hal yang ia jaga.

Tujuh mutasi, semua menyala, termasuk yang terakhir itu. Refactor-nya
*count-neutral* — total tetap 83 sebelum dan sesudah, bukti tidak ada
pemeriksa yang tercipta atau hilang diam-diam.

### `docs/PRICING.md` masuk ke dalam pemeriksa

Ia duduk di luar `check-docs.py` dan membusuk persis seperti yang diramalkan
docstring skrip itu untuk PRD dan UI-SPEC di Fase 10. Ia masih menjual
*"304 backend tests and 61 machine-verified documentation claims"* ketika
angka sebenarnya 305 dan 87.

Itu dokumen yang dibaca pembeli. Angka yang terlalu rendah pun tetap klaim
yang salah, dan satu-satunya alasan ia tidak ketahuan adalah karena tidak ada
yang menjalankannya. Kedua berkas harga kini mengutip angka yang sama dengan
README, diperiksa terhadap runner yang sama. Tiga mutasi, semua menyala —
termasuk melebihkan jumlah tes menjadi 450.

### Lint menangkap bug perbaikan saya sendiri

`sed` yang memasang jam memakai lookahead `(?!\s*now)`, yang melewatkan dua
call site di mana `now` muncul **belakangan** di objek. Hasilnya kunci
duplikat; di JavaScript yang menang adalah yang terakhir, jadi di dua tempat
pin-nya diam-diam ditimpa dan tesnya tetap hijau. `no-dupe-keys` yang
menangkapnya.

Dicatat karena polanya sama dengan seluruh fase ini: perbaikan yang lulus tes
bukan berarti perbaikan yang benar.

### Status

Klaim dokumen 83 -> 87. Test backend 304 -> 305.

305 backend - 129 frontend - lint bersih - 7 gerbang PASS - 18 plate -
282 sprite (132 reproducible) - 87 klaim.
