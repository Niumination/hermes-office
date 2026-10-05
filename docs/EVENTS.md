# Events Contract — Hermes Office

> Sumber kebenaran untuk semua event yang mengalir antara bridge → office-server → browser.
> Perubahan pada dokumen ini WAJIB diikuti perubahan `server/eventbus.js` dan test contract.

## 1. Envelope

Semua event POST ke `POST /event` dengan header `Authorization: Bearer <source-token>`.

```json
{
  "type": "<event-type>",
  "source": "cloud | mac | github | system",
  "ts": 1791025301000,
  ...payload
}
```

- `type` — salah satu dari daftar di bawah (validasi ketat; unknown type → HTTP 400)
- `source` — diisi server berdasarkan token yang dipakai (client-supplied value diabaikan)
- `ts` — opsional; server set `Date.now()` jika absen
- Semua field string di-clamp maks 500 char (kecuali `text` chat: 4000)

## 2. Event Types (warisan Claude-Office)

### `agent_spawned`
```json
{ "type": "agent_spawned", "agent": { "name": "cloud", "role": "generalist", "task": "menyiapkan laporan", "id": "opt-1" } }
```
| Field | Req | Catatan |
|---|---|---|
| agent.name | ✓ | `cloud`, `mac`, `sub:<name>`, `cron:<job>`, `octo` (github), `cron-runner` |
| agent.role | ✓ | sprite selector: `generalist`, `researcher`, `coder`, `reviewer` |
| agent.task | | teks speech bubble |
| agent.id | | stable id untuk dedupe |

### `agent_finished`
```json
{ "type": "agent_finished", "agentId": "cloud", "summary": "laporan terkirim" }
```

### `tool_call`
```json
{ "type": "tool_call", "agentId": "cloud", "tool": "web_search", "detail": "github api rate limit" }
```
→ karakter menampilkan typing bubble.

### `tool_done`
```json
{ "type": "tool_done", "agentId": "cloud", "tool": "web_search" }
```

### `mcp_call`
```json
{ "type": "mcp_call", "server": "github-mcp", "tool": "list_issues", "agentId": "cloud" }
```

### `office_chat`
Internal (dari /chat routes), tidak diterima dari /event.

## 3. Event Types Baru (Hermes Office)

### `a2a_task_in`
A2A task diterima oleh salah satu instance.
```json
{ "type": "a2a_task_in", "dest": "cloud", "peer": "mac", "taskId": "task-ddbf...", "summary": "inventory ekosistem" }
```

### `a2a_task_out`
Task yang dikirim keluar oleh instance.
```json
{ "type": "a2a_task_out", "origin": "mac", "peer": "cloud", "state": "completed", "summary": "..." }
```
`state`: `sent | working | completed | failed` → mempengaruhi animasi karakter.

### `cron_fired`
```json
{ "type": "cron_fired", "job": "price-monitor", "dest": "telegram", "ok": true }
```
→ karakter `cron-runner` berjalan ke meja yang relevan.

### `git_push`
```json
{
  "type": "git_push",
  "repo": "brain",
  "privat": true,
  "author": "zaryu",
  "commits": 2,
  "message": "chore(brain): perbarui indeks",
  "url": "https://github.com/Niumination/brain"
}
```
- `privat: true` → event ini TIDAK dikirim ke guest (server-side filter)
- Karakter `octo` muncul di meja GitHub selama 30s

### `channel_msg`
Aktivitas messaging gateway (metadata saja, BUKAN isi pesan).
```json
{ "type": "channel_msg", "platform": "telegram", "channelType": "group", "direction": "in", "agent": "cloud" }
```
**Larangan:** payload tidak boleh memuat isi pesan, nama chat, atau user id. Hanya platform + arah.

### `agent_status`
Heartbeat 30s dari tiap instance (di-set oleh bridge).
```json
{ "type": "agent_status", "agent": "mac", "state": "idle", "uptimeH": 26.4 }
```
`state`: `idle | working | away`. Server menandai `away` otomatis bila tidak ada heartbeat 90s.
Field `agent` boleh berupa **string** (`"mac"`) atau **objek** (`{name, id, role}`) — server & frontend mengambil key presence dari `agent.id ?? agent.name ?? agent` (jangan pernah mem-objek langsung sebagai Map key).

Field opsional (DUAL-SPACE-DESIGN §2.2, backward-compatible):
- `lastSeenTs` — di-set server saat emit `away` (watchdog), agar UI bisa menampilkan "terakhir aktif HH:MM" tanpa query ulang. Server juga menyimpan snapshot di `GET /presence`.
- `metrics` — objek angka bebas (mis. `disk_free_gb`, `load_1m`, `uptime_s`). Validasi longgar: hanya angka/string yang dipertahankan, nilai angka di-clamp ±1e12, field non-skalar dibuang.

### `service_status`
Status layanan per host (M-B: dikirim poller systemd cloud & mac-relay v2; saat M-A boleh dikirim manual/dummy via `/event`).
```json
{
  "type": "service_status",
  "host": "cloud",
  "unit": "hermes-office",
  "kind": "systemd",
  "state": "active",
  "detail": "uptime 3d, last run 02:00 UTC"
}
```
| Field | Req | Catatan |
|---|---|---|
| host | ✓ | `cloud` \| `mac` (whitelist) |
| unit | ✓ | nama systemd unit / launchd label / cron job |
| kind | | `systemd` \| `cron` \| `launchd` |
| state | ✓ | `active` \| `failed` \| `inactive` (whitelist) |
| detail | | opsional, clamp 500; **guest**: path/URL internal di-sanitize (`[path]`), detail ber-IP internal dibuang |

## 4. Server → Client (WS)

WS frame:
```json
{ "channel": "event", "data": { ...envelope dengan source terisi... } }
```
Channel lain: `chat_delta`, `chat_done`, `typing`, `reaction`, `roster` (full refresh).

Guest filtering di server: sebelum broadcast, event `git_push{privat:true}` dan semua `office_chat` content dihapus/diganti untuk koneksi guest.

## 5. Redaction Rules (server-side, sebelum persist & broadcast)

Pola yang dibuang/diganti `[REDACTED]`:
- `sk-...`, `ghp_...`, `github_pat_...`, `vik_...`, `xox...`
- JWT: `eyJ...\.eyJ...\....`
- `Bearer ...`
- Key-value umum: `("api[_-]?key|token|secret|password")\s*[:=]\s*\S+`

## 6. Rate & Size Limits

| Batas | Nilai |
|---|---|
| Body size | 16 KB |
| Event/min per token | 120 |
| Burst | 30 dalam 5 detik |
| Ring buffer events | 7 hari / 100k baris (yang lebih dulu penuh) |

## 7. Versioning

Handshake WS mengirim `{"channel":"hello","data":{"server":"1.0","events":[...supported types...]}}`.
Client wajib toleran terhadap type tak dikenal (abaikan). Penambahan type = minor bump; perubahan field = major bump + migrasi bridge.

## 8. Presence endpoint (DUAL-SPACE-DESIGN §3)

`GET /presence` (butuh auth) → snapshot kondisi heartbeat per agent:

```json
{ "agents": { "mac": { "lastSeenTs": 1791124000000, "online": false } }, "watchdogMs": 90000 }
```

- `online` = heartbeat diterima < 90s lalu (watchdog yang sama dengan emit `away`).
- `lastSeenTs` tetap tersimpan setelah agent `away` (tidak dihapus) untuk tampilan "terakhir aktif HH:MM".
