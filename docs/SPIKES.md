# M0 Spikes — Rencana Validasi

> Sebelum menulis production code, 4 spike menjawab pertanyaan berisiko tertinggi.
> Setiap spike: standalone, disposable, README dengan verdict.

| # | Spike | Given/When/Then | Risk | Est |
|---|---|---|---|---|
| S1 | hermes-plugin-event-capture | Given plugin `office-bridge` terpasang, When sebuah turn selesai di Hermes Cloud, Then POST /event diterima office-server < 1s tanpa mempengaruhi gateway | **High** — plugin API bisa berbeda dari dugaan | 0.5 hari |
| S2 | mac-relay-tailscale | Given mac-relay.sh jalan via launchd di Mac, When baris baru muncul di a2a_audit.jsonl, Then event sampai di server via Tailscale < 2s | Medium — launchd di Mac, network | 0.5 hari |
| S3 | frontend-standalone-render | Given frontend Claude-Office di-port + mock event feeder, When WS kirim agent_spawned/tool_call, Then karakter beranimasi benar tanpa server asli | Medium — ketergantungan internal src/ | 1 hari |
| S4 | chat-bridge-streaming | Given office-server proxy ke Hermes API /v1/chat/completions stream, When user kirim chat, Then SSE → WS frame chat_delta tampil streaming di panel | Medium | 0.5 hari |

## Urutan eksekusi
S1 → S4 → S3 → S2 (riskiest first; S2 butuh akses Mac dari user).

## Format Verdict
Setiap `spikes/<id>/README.md` ditutup:

```
## Verdict: VALIDATED | PARTIAL | INVALIDATED
### What worked
### What didn't
### Surprises
### Recommendation for the real build
```

INVALIDATED pada S1/S2 = kembali ke meja gambar arsitektur (PRD §5) sebelum M1.
INVALIDATED pada S3/S4 = cari alternatif (embed lebih dalam / polling saja).
