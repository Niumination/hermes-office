# Flight Recorder & Compliance Dossier (Fase 4)

Catatan tata kelola yang **append-only** dan **hash-chained**, plus
penerjemahnya menjadi dokumen yang bisa dibaca petugas kepatuhan.

Fase 1–3 membangun jalur keputusan: OTLP memberi tahu apa yang dilakukan agen,
burn-rate dan denah lantai memutuskan apa yang boleh dilakukan berikutnya.
Tidak satu pun **tercatat** dalam bentuk yang bisa dipertahankan di hadapan
auditor. Ring buffer menyimpan 7 hari di RAM dan hilang saat restart — itu
monitoring, bukan jejak audit.

---

## 1. Kenapa ini ada

Kewajiban sistem AI berisiko tinggi di EU AI Act berlaku sejak **2 Agustus 2026**:

| Pasal | Kewajiban | Bagaimana dipenuhi di sini |
|---|---|---|
| Art. 12(1) | Pencatatan peristiwa **otomatis** sepanjang masa pakai sistem. Pencatatan manual eksplisit tidak memenuhi syarat. | Setiap keputusan ditulis dari dalam jalur permintaan, tanpa aksi operator |
| Art. 14 | Bukti bahwa manusia dapat mengawasi dan **menghentikan** | Antrian persetujuan + waktu tunggu tiap keputusan dicatat |
| Art. 19 / 26(6) | Log disimpan **≥ 6 bulan** | Retensi default **400 hari** |
| Art. 99(4) | Denda hingga **€15 jt atau 3% omzet global** | — |

Standar teknis yang diharapkan asesor: append-only, tamper-evident, **rantai
hash SHA-256**.

---

## 2. Apa yang dicatat — dan apa yang sengaja tidak

Hanya **keputusan** dan **perubahan cakupan wewenang**, bukan seluruh firehose
event. Dosir yang tak bisa dibaca petugas kepatuhan tidak ada nilainya, dan
keluhan paling sering dari praktisi memang persis itu: mereka diberi log I/O
mentah.

| Tipe rekaman | Kapan |
|---|---|
| `chain_opened` | Rantai dimulai |
| `policy_loaded` | Saat startup — **aturan apa yang berlaku** saat keputusan dibuat |
| `policy_decision` | Setiap evaluasi `/policy/check` |
| `approval_requested` | Aksi ditahan menunggu manusia |
| `approval_resolved` | Disetujui / ditolak / **kedaluwarsa** |
| `agent_moved` | Perubahan cakupan wewenang, berikut `grantedBy` |
| `budget_transition` | Tangga pembelanjaan berubah keadaan |
| `chain_checkpoint` | Jangkar periodik |
| `chain_truncated` | Celah retensi, **dideklarasikan** bukan disembunyikan |
| `dossier_exported` | Siapa menarik log audit, kapan |

**Isi prompt dan completion tidak pernah masuk ledger.** Tidak diperlukan untuk
merekonstruksi sebuah keputusan, dan justru bagian paling mungkin membawa data
pribadi — yang akan menyeret dosirnya sendiri ke ranah GDPR.

---

## 3. Model ancaman — baca ini sebelum menyebut "tamper-proof"

Rantai hash bersifat **tamper-evident**, bukan tamper-proof. Perbedaannya
menentukan segalanya dalam audit:

| Serangan | Terdeteksi? |
|---|---|
| Mengubah isi rekaman di tempat | ✅ `content-altered`, menyebut seq persisnya |
| Mengubah timestamp | ✅ `ts` bagian dari preimage |
| Menghapus rekaman dari **tengah** | ✅ `broken-link` |
| Mengubah isi **dan** menghitung ulang hash-nya | ✅ rekaman berikutnya sudah terikat ke hash lama |
| Menghapus rekaman dari **ekor** | ❌ **TIDAK.** Rantai yang dipendekkan tetap konsisten secara internal |
| Menulis ulang seluruh berkas dari nol | ❌ **TIDAK.** Penyerang dengan akses tulis bisa memalsukan riwayat bersih |

Dua baris terakhir hanya tertutup dengan **menjangkarkan head hash di tempat
yang tidak dikuasai penyerang**. Karena itu `GET /ledger/head` ada: nilainya
kecil dan murah disalin ke log drain, commit git, atau layanan co-signing.
Tanpa itu, jangan mengklaim lebih dari yang kriptografinya berikan.

Ada satu test yang **sengaja menegaskan keterbatasan ini**
(`LIMITATION: tail truncation is NOT detected`) supaya klaimnya tidak diam-diam
menggelembung seiring waktu.

---

## 4. Canonical JSON

Rantai hanya sehandal fungsi serialisasinya. Bila dua proses bisa
men-serialisasi rekaman logis yang sama secara berbeda, verifikasi gagal pada
data jujur — dan alarm palsu dalam audit hampir sama merusaknya dengan
kebocoran yang terlewat.

- Kunci objek diurutkan menurut UTF-16 code unit
- `undefined` dibuang dari objek, jadi `null` di dalam array (sama dengan `JSON.stringify`, supaya pemeriksaan manual dengan `jq` sepakat)
- Tanpa whitespace
- `NaN` / `±Infinity` → `null`
- Siklus **melempar error**, tidak memotong diam-diam

```
hash = SHA256( canonicalJson({seq, ts, prevHash, type, actor}) + "\n" + payloadCanonical )
```

Posisi ikut di-hash, bukan hanya isi — kalau tidak, dua keputusan identik akan
berhash sama dan bisa ditukar tanpa terdeteksi.

---

## 5. Endpoint

Semuanya **owner-only, tanpa kecuali**. Ledger adalah satu-satunya tempat semua
fakta yang diredaksi dari guest di Fase 3 tertulis lengkap. Token bridge —
yang dipegang setiap proses agen — justru paling tidak boleh, karena agen
adalah **subjek** catatan ini.

| Endpoint | Fungsi |
|---|---|
| `GET /ledger/head` | `{seq, hash, records}` — nilai untuk dijangkarkan |
| `GET /ledger/verify` | Hitung ulang seluruh rantai; laporkan putus pertama |
| `GET /ledger?type=&subject=&from=&to=` | Rekaman mentah, untuk tooling |
| `GET /dossier?from=&to=&format=md\|json` | Dokumen kepatuhan |

Verifikasi melaporkan **putus pertama saja**: setelah satu mata rantai rusak,
semua sesudahnya tidak terverifikasi, dan menampilkan ribuan kegagalan turunan
hanya akan mengubur suntingan yang sebenarnya.

---

## 6. Isi dosir

1. **Integritas lebih dulu.** Dosir yang integritasnya sendiri diragukan harus
   mengatakannya di awal, bukan menyembunyikannya di lampiran. Bila rantai
   putus, halaman pertama berbunyi *"THE LOG DOES NOT VERIFY — this dossier
   must not be relied upon as evidence."*
2. **Pengawasan manusia (Art. 14)** — berapa aksi dihentikan, berapa disetujui
   / ditolak / kedaluwarsa, dan **median waktu respons manusia**. Kemampuan
   pengawasan yang tak pernah dijalankan bukanlah pengawasan.
3. **Keputusan yang ditegakkan** — tabel per aksi, lalu daftar penolakan.
4. **Perubahan cakupan & kendali belanja.**
5. **Catatan lengkap** sebagai narasi per hari. Setiap kalimat membawa nomor
   seq-nya, jadi auditor skeptis bisa kembali ke rekaman mentahnya.
6. **Cara memverifikasi sendiri**, termasuk rumus hash-nya.

Format Markdown karena bertahan saat ditempel ke tiket, bisa dikonversi ke PDF
dengan alat apa pun yang sudah dimiliki pelanggan, dan — tidak seperti PDF yang
kami bangkitkan — tetap bisa di-`diff`, sehingga dua dosir periode berdekatan
dapat dibandingkan.

### Injeksi Markdown

Nama agen sampai ke ledger lewat span OTLP, artinya **dipengaruhi penyerang**.
Nama seperti `` evil`\n\n## Forged Heading `` yang ditempel mentah bisa
memalsukan struktur di dokumen yang justru dibaca sebagai bukti. Semua nilai
yang diinterpolasi melewati `safe()`: karakter kontrol dan newline jadi spasi,
backtick jadi apostrof, dan di dalam tabel pipe ikut di-escape. Nilainya tetap
**dilaporkan**, hanya dinetralkan — meredaksi akan lebih buruk, karena auditor
perlu tahu siapa yang bertindak.

---

## 7. Retensi

Pemangkasan hanya pernah membuang **prefiks** (rekaman tertua), tidak pernah
dari tengah — membuang dari tengah akan memutus setiap mata rantai sesudahnya
dan membuat ledger tidak terverifikasi. Penanda `chain_truncated` mencatat apa
yang dibuang beserta hash mata rantai terakhir yang hilang, jadi sisa rantai
tetap verify dan celahnya **dideklarasikan**. Memangkas seluruh rantai ditolak.

---

## 8. Konfigurasi

| Env | Default | Catatan |
|---|---|---|
| `OFFICE_LEDGER_ENABLED` | `1` | Jejak audit yang harus dinyalakan dulu adalah jejak audit yang akan mati saat insiden terjadi |
| `OFFICE_LEDGER_DB` | `<dataDir>/ledger.db` | Berkas terpisah dari `office.db`: beda aturan retensi, beda aturan akses, dan bisa diarsipkan tanpa ikut membawa riwayat chat |
| `OFFICE_LEDGER_RETENTION_DAYS` | `400` | `0` menonaktifkan pemangkasan |
| `OFFICE_LEDGER_CHECKPOINT_EVERY` | `500` | |
| `OFFICE_LEDGER_RECORD_ALLOWS` | `1` | Mencatat aksi yang **diizinkan** juga adalah yang membuat log ini jadi catatan lengkap, bukan daftar insiden. Art. 12 meminta yang pertama |
| `OFFICE_LEDGER_SYNCHRONOUS` | `FULL` | fsync tiap append |

Bila ledger gagal dibuka, server **tetap berjalan** tetapi mencetak
`[ledger] DISABLED` dan `Decisions will be enforced but NOT recorded.` — lalu
seluruh endpoint audit menjawab **503**. Menolak berpura-pura lebih baik
daripada diam-diam berhenti mencatat.

Kegagalan menulis satu rekaman dicatat keras tetapi **tidak menolak aksinya**:
kantor yang berhenti mengatur saat diska penuh lebih buruk daripada yang punya
celah di lognya. Celahnya pun terlihat — nomor seq berurutan.

---

## 9. Performa (terukur, bukan perkiraan)

Diukur di sandbox ini, 2.000 rekaman per mode:

| `synchronous` | per rekaman | keputusan/dtk |
|---|---|---|
| `FULL` | 0,020 ms | ~49.000 |
| `NORMAL` | 0,019 ms | ~52.000 |
| `OFF` | 0,018 ms | ~57.000 |

Durabilitas penuh praktis gratis di sini — **tetapi** perlu kehati-hatian:
sandbox kontainer sering punya `fsync` yang jauh lebih murah daripada diska
jaringan sungguhan. Pada penyimpanan nyata selisih `FULL` vs `NORMAL` akan
lebih besar. Default tetap `FULL`, karena keputusan yang ditegakkan tetapi
tidak tercatat secara durabel adalah persis celah yang dicari auditor.

Skala 100.000 rekaman: tulis 2,1 dtk · **verify 0,7 dtk** · berkas 31,3 MB.
Ekstrapolasi **~1,1 GB/tahun** pada 10.000 keputusan/hari. Itulah alasan
`OFFICE_LEDGER_RECORD_ALLOWS` ada — tetapi matikan hanya bila volume tulis
benar-benar menuntut, dan siapkan jawaban saat asesor bertanya kenapa.

---

## 10. Hubungan dengan fase lain

- **Fase 1 (OTLP)** memasok biaya nyata yang memicu transisi anggaran.
- **Fase 2 (Burn-Rate)** menyumbang `budget_transition`.
- **Fase 3 (Policy-as-Floor-Plan)** menyumbang sisanya. Satu hook `onEvent`
  mencakup ketiga event tata kelola, jadi tipe event baru tidak bisa
  ditambahkan ke mesin kebijakan lalu diam-diam melewati log audit.

Satu celah nyata ditemukan saat membangun fase ini: **kedaluwarsa persetujuan
dulu terjadi tanpa event sama sekali**, sehingga ledger mencatat permintaan
tanpa hasil. "Tidak ada yang menjawab, jadi aksinya tidak terjadi" justru bukti
positif bahwa sistem *fail closed* — persis yang diminta Art. 14 — maka kini
diterbitkan seperti resolusi lainnya.


---

## Penambatan Eksternal (Fase 11)

Sejak Fase 4 dokumen ini menyatakan dua serangan yang **tidak** dideteksi
rantai: **pemotongan ekor** dan **regenerasi menyeluruh**. Keduanya lolos
`GET /ledger/verify` dengan centang hijau sempurna, karena keduanya
menghasilkan rantai yang konsisten secara internal.

Itu tidak bisa diperbaiki dari dalam berkas. Sebuah rantai hanya bisa
membuktikan konsistensi dirinya sendiri; ia tidak bisa membuktikan bahwa versi
yang lebih panjang pernah ada. Perbaikannya bukan kriptografis melainkan
**sosial**: terbitkan hash kepala ke tempat yang tidak bisa diraih ulang
server ini.

Begitu `{seq: 4120, hash: "9f3a…"}` ada di tangan orang lain, server tidak bisa
lagi berpura-pura seq 4120 berisi hal lain, atau bahwa rantainya berakhir di
4000. Ia **tetap bisa berbohong tentang masa depan**. Ia tidak bisa menarik
kembali apa yang sudah diterbitkan.

### Kekuatan bukan biner

| Jenis | Ke mana | Kekuatan |
|---|---|---|
| `local` | `anchors.jsonl` di samping `ledger.db` | **Lemah** — root yang menulis ulang ledger menulis ulang ini juga |
| `remote` | webhook yang dikonfigurasi operator, balasan 2xx | **Kuat** — sekuat independensi endpoint itu |

Tambatan lokal **tidak** berarti tidak berguna: ia menahan kasus realistis
(proses atau operator menyunting `ledger.db`, bug aplikasi, pemulihan
sebagian) dan harganya nol. Ia hanya lebih lemah daripada tanda terima yang
dipegang pihak ketiga, jadi `verify()` memberi label berbeda dan **tidak
pernah** membiarkan setelan lokal-saja melaporkan diri sebagai tertambat kuat.
Seribu tambatan di disk yang sama tetap `strength: "local"`.

### Tiga hasil per tambatan

| Hasil | Arti |
|---|---|
| `ok` | rantai masih memuat hash itu persis pada seq itu |
| `truncated` | rantai kini **lebih pendek** daripada tambatan yang kita terbitkan — record yang terbukti pernah ada sudah hilang |
| `diverged` | ada record di seq itu tapi hash-nya berbeda — rantai **dibangun ulang**, bukan sekadar dipangkas |

`diverged` lebih buruk daripada `truncated` dan dilaporkan lebih dulu.

### Konfigurasi

| Env | Default | Catatan |
|---|---|---|
| `OFFICE_ANCHOR_ENABLED` | `1` | `0` mematikan; pemotongan ekor kembali tak terdeteksi |
| `OFFICE_ANCHOR_FILE` | `<dataDir>/anchors.jsonl` | **jangan** taruh di dalam `ledger.db` |
| `OFFICE_ANCHOR_WEBHOOKS` | — | dipisah koma; ini yang membuatnya kuat |
| `OFFICE_ANCHOR_INTERVAL_MS` | `3600000` | 1 jam: paling lama satu jam ekor tanpa perlindungan |
| `OFFICE_ANCHOR_TIMEOUT_MS` | `5000` | per-webhook |

### Yang perlu Anda tahu sebelum memercayainya

1. **Tambatan hanya mengikat masa lalu.** Rantai yang lebih panjang daripada
   tambatan terbarunya adalah keadaan normal dan sehat. Jendela antar-tambatan
   adalah jumlah ekor yang masih bisa dihapus tanpa jejak — perpendek
   intervalnya kalau itu penting bagi Anda.

2. **Lokal-saja tidak menahan root.** Kalau model ancaman Anda memuat
   administrator yang bermusuhan, `OFFICE_ANCHOR_WEBHOOKS` wajib, bukan
   opsional.

3. **Mencatat kegagalan mengubah kategorinya.** Saat boot mendeteksi
   pemotongan, server menulis record `chain_truncated` — dan record itu
   menempati nomor urut yang baru saja dikosongkan. Boot berikutnya karena itu
   melaporkan `diverged`, bukan `truncated`. Tetap terdeteksi, tetap gagal,
   tapi labelnya berubah. Ini efek samping nyata dari mencatat ke dalam
   artefak yang sedang diperiksa, dan dicatat di sini alih-alih dibiarkan
   mengejutkan seseorang saat audit.

4. **Penambatan tidak pernah memblokir.** Sama seperti penulisan ledger:
   kegagalan menambat tidak pernah menolak aksi atau membuat proses mati.
   Fitur audit yang bisa menjatuhkan produk adalah fitur audit yang akan
   dimatikan operator.

### Yang **masih** tidak terdeteksi

Server yang berbohong **sejak awal** — tidak pernah mencatat sebuah keputusan
sama sekali. Tidak ada rantai yang bisa menangkap itu; nomor urut yang
bersambung hanya membuktikan tidak ada yang dihapus *setelah* ditulis.
Itu batas permanen, dan ia milik dokumen ini, bukan bug.
