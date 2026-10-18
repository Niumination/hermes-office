# hermes-emit — menyalakan cermin

Hermes Office bisa menggambar dua belas jenis kegiatan. Servernya memvalidasi
tujuh belas jenis peristiwa. `POST /event` sudah hidup sejak hari pertama.

Tidak ada satu pun yang bergerak, karena **tidak ada yang pernah mengirim**.
Kantor itu jendela ke ruangan yang tak pernah dimasuki siapa pun.

Modul ini yang memasukinya.

---

## Apa yang terjadi setelah ini dipasang

Anda mengetik perintah di Telegram. Di layar kantor, pada detik yang sama:

| Yang Anda lakukan | Yang muncul di kantor |
|---|---|
| Kirim perintah ke agen via Telegram | Karakter agen menyala, status "menerima pesan" |
| Agen mulai mengerjakan repo X | Agen berpindah ke ruangan kerja, animasi bekerja |
| Agen menjalankan `bash`, `edit`, `grep` | Status berganti mengikuti alat yang dipakai |
| Agen melakukan `git push` | Peristiwa push muncul di Babad |
| Agen menunggu jawaban Anda | Status "menunggu jawaban" — tidak lagi pura-pura sibuk |
| Agen selesai | Karakter kembali tenang |

Semuanya tercatat permanen di rantai catatan, bisa diputar ulang, dan bisa
dilihat di papan tanpa membocorkan isi percakapan.

---

## Aturan utama: ini tidak boleh merusak gateway Anda

Dasbor yang menjatuhkan pesan Telegram pengguna lebih buruk daripada tidak
punya dasbor sama sekali. Maka modul ini:

- **tidak pernah melempar eksepsi** — setiap fungsi publik mengembalikan `None`;
- **tidak pernah memblokir** — pengiriman terjadi di utas latar;
- **membuang, bukan menumpuk** — antrean dibatasi 256; saat kantor lambat,
  peristiwa dibuang, bukan dikumpulkan sampai gateway kehabisan memori;
- **menahan laju sendiri** (110/menit) agar tidak dibanjiri 429 dari server;
- **tanpa dependensi pihak ketiga** — hanya `urllib`. Tidak ada yang perlu
  dipasang, tidak ada permukaan rantai pasok baru di gateway yang memegang
  pesan Anda.

Diuji pada sembilan kondisi gagal — kantor mati, DNS gagal, token salah,
string 1 MB, banjir 2000 peristiwa. Semuanya kembali di bawah 10 ms tanpa satu
pun eksepsi lolos.

Kalau `OFFICE_URL` tidak diatur, seluruh modul jadi no-op. Mengimpornya ke
gateway yang belum dikonfigurasi tidak mengubah apa pun.

---

## Privasi

`docs/EVENTS.md` §3 melarang isi pesan, nama chat, dan id pengguna. Server
menolak peristiwa yang membawanya.

`emit_channel_msg()` **tidak menerima parameter isi pesan sama sekali**. Yang
dikirim hanya bentuk lalu lintasnya: platform mana, arah mana, agen mana.
Kantor memperlihatkan bahwa Anda sedang bicara dengan agen — tidak pernah apa
yang Anda katakan.

Hal yang aman dibuat jadi hal yang mudah.

---

## Pemasangan

Salin satu berkas. Tidak ada `pip install`.

```bash
scp bridges/hermes-emit/hermes_emit.py <host>:~/.hermes/
```

Konfigurasi lewat `~/.hermes/.env` (dibaca otomatis):

```
OFFICE_URL=https://dash.abstract.biz.id
OFFICE_TOKEN=<token bridge>
OFFICE_SOURCE=cloud
```

Uji:

```bash
python3 ~/.hermes/hermes_emit.py
```

Keluaran yang benar berakhir dengan `"sent": 1`.

---

## Langkah nol: denyut hidup

Sebelum menyentuh kode gateway, nyalakan ini. Satu perintah, dan kantor
berhenti berkata "belum pernah ada agen yang terlihat".

```bash
scp bridges/hermes-emit/{hermes_emit.py,denyut.py} <host>:~/.hermes/
ssh <host> 'python3 ~/.hermes/denyut.py --once'
```

Sebagai layanan yang bertahan melewati reboot:

Host produksi (unit *system*, home `/root`):

```bash
sudo cp bridges/hermes-emit/hermes-denyut.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-denyut
journalctl -u hermes-denyut -f
```

Host dengan user-service systemd (mis. LightVela, user `agentuser`, home
`/home/agentuser`): unit aslinya memakai `User=root` + `WantedBy=multi-user.target`,
yang tidak berlaku di user-manager. Sesuaikan, lalu pasang:

```bash
sed -e 's/^User=root/Environment=HOME=\/home\/agentuser/' \
    -e 's|/root/\.hermes|/home/agentuser/.hermes|g' \
    -e 's/^WantedBy=multi-user.target/WantedBy=default.target/' \
    bridges/hermes-emit/hermes-denyut.service \
  > ~/.config/systemd/user/hermes-denyut.service
systemctl --user daemon-reload && systemctl --user enable --now hermes-denyut
journalctl --user -u hermes-denyut -f
```

Kedua unit memakai `EnvironmentFile` yang menunjuk `~/.hermes/.env` — nilai
`OFFICE_URL`, `OFFICE_TOKEN`, `OFFICE_SOURCE` dibaca dari sana, bukan
dipaste ke unit.

**PENTING — jangan pakai sandbox berat di user unit.** Unit ini mengunci
`ProtectSystem=strict`, `PrivateTmp`, `SystemCallFilter` yang hanya berlaku
di unit *system*. Kalau dipasang di user-manager, systemd tidak bisa
menetapkan `NoNewPrivileges` + `SystemCallFilter` di user service,
dan unit akan mati dengan `status=216/GROUP`. Kurangi ke:
`ProtectSystem=strict` saja (untuk user) dan hapus `NoNewPrivileges` +
`PrivateTmp` + `SystemCallFilter` + `SystemCallArchitectures`.

**Kenapa denyut perlu ada sama sekali.** Kantor menandai agen luring setelah
90 detik tanpa kabar, dan itu memang benar — presensi yang tidak pernah luruh
akan berbohong tentang siapa yang hadir. Diuji: dua agen dinyalakan, satu
diberi denyut dan satu tidak; setelah 100 detik yang berdenyut tetap hadir,
yang diam jadi luring. Jadi agen yang menganggur memang menghilang dari balai.
Tepat, tapi tidak berguna sebagai tanda "mesin ini menyala". Denyut mengisi
celah itu.

`--interval` ditolak kalau lebih dari 45 detik: dengan ambang 90 detik, jeda
30 memberi dua kesempatan gagal sebelum agen terlihat luring.

**Apa yang denyut TIDAK lakukan.** Ia hanya membuktikan mesinnya hidup. Agen
akan berdiri diam di balai — tidak ada alat yang dipakai, tidak ada amanat
berjalan, tidak ada peristiwa di Babad. Untuk itu gateway harus memanggil
`hermes_emit` sendiri; bagian berikut menjelaskan caranya.

Agen yang baru berdenyut belum punya ruangan dan akan terhitung "di ruangan
tak dikenal". Pemilik menempatkannya:

```bash
curl -X POST -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" \
     -H "Content-Type: application/json" -d '{"room":"lightvela/root"}' \
     https://dash.abstract.biz.id/agents/cloud/room
```

Penempatan sengaja jadi tindakan pemilik, bukan sesuatu yang agen klaim
sendiri — kalau agen boleh memilih ruangannya, denah lantai berhenti jadi
pernyataan tata kelola.

---

## Integrasi per gateway

### 1. Telegram

Di tempat Anda menangani pesan masuk:

```python
import sys; sys.path.insert(0, "/root/.hermes")
import hermes_emit as he
he.configure()

async def on_message(update, context):
    he.emit_channel_msg(platform="telegram", direction="in", agent="cloud")
    he.emit_agent_status(agent="cloud", state="working")

    reply = await jalankan_agen(update.message.text)   # kerja Anda yang asli

    he.emit_channel_msg(platform="telegram", direction="out", agent="cloud")
    he.emit_agent_status(agent="cloud", state="idle")
    await update.message.reply_text(reply)
```

Dua baris di awal, dua di akhir. Tidak ada `try/except` — modulnya sudah
menelan semuanya sendiri.

### 2. WhatsApp

Sama persis, ganti platformnya:

```python
he.emit_channel_msg(platform="whatsapp", direction="in", agent="cloud")
```

### 3. Hermes Desktop (Mac)

Denyut hidup supaya karakter Mac "datang kerja" saat laptop menyala:

```python
import threading, hermes_emit as he
he.configure(source="mac")

def denyut():
    while True:
        he.emit_agent_status(agent="mac", state="working")
        threading.Event().wait(30)      # server menandai away setelah 90 detik

threading.Thread(target=denyut, daemon=True).start()
```

### 4. A2A antara Mac dan Cloud

Siklus hidup tugas A2A v1.0 kini diterima penuh — delapan status:

```python
he.emit_a2a_task_out(origin="cloud", peer="mac", task_id=tid, state="submitted")
he.emit_a2a_task_out(origin="cloud", peer="mac", task_id=tid, state="working")
# agen berhenti menunggu jawaban Anda:
he.emit_a2a_task_out(origin="cloud", peer="mac", task_id=tid, state="input_required")
he.emit_a2a_task_out(origin="cloud", peer="mac", task_id=tid, state="completed",
                     summary="repo lightvela: build diperbaiki")
```

Di sisi penerima:

```python
he.emit_a2a_task_in(dest="mac", peer="cloud", task_id=tid,
                    summary="repo lightvela: perbaiki build")
```

`summary` tampil apa adanya di kantor — isi label singkat, jangan seluruh
perintah.

Sudah ada `bridges/mac-relay/` yang merelay audit A2A dari berkas log. Modul
ini untuk kode yang bisa Anda sunting langsung; keduanya bisa jalan bersamaan.

### 4b. Papan Amanat — "sedang mengerjakan apa"

Ini yang mengisi tab **Amanat**. Tanpa ini kantor bisa menunjukkan agen Anda
sibuk, tapi tidak pernah sedang mengerjakan apa.

```python
# perintah masuk → amanat lahir
he.emit_task_update("T-401", "submitted",
                    title="repo lightvela: perbaiki build",
                    agent="cloud", origin="telegram", repo="lightvela")

he.emit_task_update("T-401", "working", agent="cloud")

# agen berhenti menunggu jawaban Anda — muncul di jalur TERTAHAN
he.emit_task_update("T-401", "input_required", agent="cloud")

he.emit_task_update("T-401", "completed", agent="cloud")
```

`task_id` boleh apa saja asal stabil sepanjang hidup amanat — id pesan
Telegram, id tugas A2A, atau UUID Anda sendiri.

`origin` menjawab **dari mana perintah datang** (`telegram`, `whatsapp`,
`desktop`, `a2a`, `cron`) — bukan mesin mana yang merelainya. Kantor memakainya
untuk memperlihatkan cara Anda sebenarnya memberi perintah.

`title` tampil apa adanya di papan amanat, jadi isi
label pendek — bukan seluruh prompt.

Amanat bertahan melewati restart: transisinya dicatat ke rantai dan papan
dibangun ulang dengan melipatnya saat boot.

### 5. Alat yang dipakai agen

Kalau runtime agen Anda punya kait sebelum/sesudah pemanggilan alat:

```python
he.emit_tool_call(agent_id="cloud", tool="bash", target="npm run build")
he.emit_tool_done(agent_id="cloud", tool="bash", ok=True)
```

### 6. Git

```python
he.emit_git_push(repo="lightvela", branch="dev", commits=2, agent_id="cloud")
```

---

## Jalan pintas: sudah pakai OpenTelemetry?

Kalau runtime agen Anda sudah mengeluarkan span OpenTelemetry GenAI, Anda tidak
perlu modul ini sama sekali. `server/otlp.js` sudah menerimanya:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://dash.abstract.biz.id
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <OFFICE_OTLP_TOKEN>
```

Span `invoke_agent`, `execute_tool`, dan `chat` otomatis jadi kegiatan kantor.
Isi prompt dan jawaban tidak pernah dibaca.

---

## Memeriksa hasilnya

```bash
bash scripts/check-live.sh
```

Pemeriksaan terakhirnya menjawab pertanyaan yang Anda pedulikan:

```
PASS  activity is flowing (last agent seen 2m ago)
```

Sebelum modul ini dipasang, baris itu berbunyi:

```
PASS  reachable, but quiet (last agent seen 268m ago)
      no agent has reported in over an hour — check the bridges are running
```

---

## Rujukan kontrak

| Peristiwa | Wajib | Catatan |
|---|---|---|
| `channel_msg` | `platform` | isi pesan dilarang keras |
| `agent_status` | `agent`, `state` | `idle` · `working` · `away` |
| `agent_spawned` | `agent.name` | objek, bukan string |
| `agent_finished` | `agentId` | |
| `tool_call` | `agentId`, `tool` | |
| `tool_done` | `agentId` | |
| `mcp_call` | `server`, `tool` | |
| `a2a_task_in` | `dest` | |
| `a2a_task_out` | `origin` | 8 status A2A v1.0 |
| `git_push` | `repo` | |
| `cron_fired` | `job` | |

String dipotong di 500 karakter. Batas server 120/menit, burst 30/5 detik.
