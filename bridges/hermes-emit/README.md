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
dilihat tamu tanpa membocorkan isi percakapan.

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
