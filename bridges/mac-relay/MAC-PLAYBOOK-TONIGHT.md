# Panduan Mac — Tahapan Malam Ini (hardening A2A + mac-relay office)

Diterbitkan dari cloud (lightvela.ai), 4 Okt 2026. Semua perintah dijalankan di Mac, user `zaryu`.
**Tidak ada token yang dikirim lewat chat** — token office-relay = token A2A kamu sendiri (sudah cocok di kedua sisi; server office sudah di-update & diverifikasi menerima token ini).

---

## TAHAP 1 — Hardening A2A: pindahkan token ke ~/.hermes/.env (tanpa jendela mati)

Urutan ini aman karena `gateway/run.py` memuat `~/.hermes/.env` dengan `override=True` — nilai `.env` selalu menang atas env dari plist.

```bash
# 1a. Ambil token yang sekarang aktif di plist, append ke ~/.hermes/.env (satu baris)
TOKEN=$(plutil -extract EnvironmentVariables.A2A_BEARER_TOKEN raw -o - \
  ~/Library/LaunchAgents/ai.hermes.gateway.plist)
grep -q '^A2A_BEARER_TOKEN=' ~/.hermes/.env || \
  echo "A2A_BEARER_TOKEN=$TOKEN" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env

# 1b. Restart gateway (bukti: PID baru, A2A tetap listen di IP Tailscale)
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
sleep 5

# 1c. Verifikasi A2A masih hidup
lsof -iTCP:9900 -sTCP:LISTEN        # harus LISTEN di zhalls-macbook-pro.tailec8707.ts.net
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9900/health   # 200
```

## TAHAP 2 — Hapus token dari plist (sekarang aman, .env sudah sumber)

```bash
# 2a. Hapus kunci token dari plist (biarkan EnvironmentVariables untuk PATH/HERMES_HOME saja)
plutil -remove EnvironmentVariables.A2A_BEARER_TOKEN \
  ~/Library/LaunchAgents/ai.hermes.gateway.plist
plutil -lint ~/Library/LaunchAgents/ai.hermes.gateway.plist   # harus OK

# 2b. Restart lagi — sekarang token hanya dari .env
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
sleep 5
lsof -iTCP:9900 -sTCP:LISTEN   # tetap LISTEN di IP Tailscale = SUKSES
```

## TAHAP 3 — Verifikasi A2A dua arah (dari Mac)

```bash
# Mac → Cloud (token peer-mu, dari vault; hash sha256[:12] = 4832aae4452c)
TOK=$(awk '{print $6}' ~/Desktop/Niumination/vault/a2a-token.txt 2>/dev/null || cat ~/Desktop/Niumination/vault/a2a-token.txt)
curl -s -o /dev/null -w 'cloud card: %{http_code}\n' --max-time 10 \
  http://<office-host>:9900/.well-known/agent.json
```

Lalu bilang ke cloud (Hermes cloud) untuk verifikasi arah sebaliknya — atau tunggu cloud mengirim ping test.

## TAHAP 4 — Pasang mac-relay office (karakter 💻 jadi online)

Repo ekosistem di Mac: `~/Desktop/Niumination`. Clone/pull repo office dulu:

```bash
# 4a. Pull repo hermes-office (sudah punya akses GitHub org)
cd ~/Desktop/Niumination
git clone https://github.com/Niumination/hermes-office.git 2>/dev/null || \
  (cd hermes-office && git pull)

# 4b. Salin relay ke ~/.hermes/office-relay
cp -r hermes-office/bridges/mac-relay ~/.hermes/office-relay

# 4c. Token relay = token A2A kamu sendiri (satu token dipakai dua arah;
#     server office sudah di-update & diverifikasi menerima nilai ini)
#     Sumber nilai: vault kamu (jangan cetak ke layar/chat)
TOK=$(cat ~/Desktop/Niumination/vault/a2a-token.txt)
grep -q '^OFFICE_MAC_TOKEN=' ~/.hermes/.env || echo "OFFICE_MAC_TOKEN=$TOK" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env

# 4d. Pasang launchd relay
sed "s|CHANGEUSER|$(whoami)|g" \
  ~/.hermes/office-relay/com.niumination.office-relay.plist \
  > ~/Library/LaunchAgents/com.niumination.office-relay.plist
launchctl load ~/Library/LaunchAgents/com.niumination.office-relay.plist

# 4e. (Opsional tapi disarankan) Octo 🐙 versi Mac — git_push watcher
# buat launchd plist serupa untuk: python3 ~/.hermes/office-relay/octo-watcher.py
# (scan ~/Desktop/Niumination tiap 60s → event git_push)
```

## TAHAP 4f — SISI SERVER: beri tahu kantor di mana `mac` berdiri

Tanpa langkah ini relay akan berhasil dan agennya tetap mendarat di
**Belum dipetakan**, bukan di Root Ekosistem. Di mesin yang menjalankan
office-server, tambahkan satu baris env lalu restart:

```bash
OFFICE_AGENT_HOMES='mac=mac/root,cloud=lightvela/root,boss=mac/root'
```

Bukti baris boot menerimanya — angka kiri harus sama dengan angka kanan:

```bash
# di log boot office-server
… "agentHomes":"3/3"
```

`3/2` atau `2/3` berarti ada home yang menunjuk ruang tak dikenal atau ruang
bergerbang; lihat `docs/POLICY.md`.

---

## TAHAP 5 — Bukti akhir: BERHENTI DI LAYAR, BUKAN DI `launchctl`

`launchctl list | grep office` yang mengembalikan PID hanya membuktikan ada
proses hidup. Ia tidak membuktikan tokennya benar, tidak membuktikan event
sampai, dan tidak membuktikan ada yang terlihat. Relay dengan token basi
memberi PID yang sama persis dengan relay yang bekerja — itulah cara
kegagalan ini bertahan berhari-hari.

Rantai buktinya ada empat mata, dan **tiga pertama tidak boleh dilaporkan
tanpa yang keempat**:

```bash
# 1. proses hidup (perlu, jauh dari cukup)
launchctl list | grep office

# 2. relay tidak sedang membuang event — DROP = token salah atau URL salah
tail -20 ~/Library/Logs/office-relay.log | grep -c DROP   # harus 0

# 3. server benar-benar menganggap mac hidup
curl -s http://<office-host>:7333/presence \
  -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" | python3 -m json.tool
#    -> "mac": { "online": true, ... }

# 4. server menempatkan mac di ruang yang benar
curl -s http://<office-host>:7333/policy \
  -H "Authorization: Bearer $OFFICE_OWNER_TOKEN" \
  | python3 -c 'import json,sys; [print(r["room"],"->",[o["agent"] for o in r.get("occupants",[])]) for r in json.load(sys.stdin)["rooms"] if r.get("occupants")]'
#    -> mac/root -> ['"'"'mac'"'"']
```

Mata rantai terakhir, dan satu-satunya yang menjawab pertanyaan aslinya:
**buka kantornya, tab 💻 Mac, dan lihat `mac` berdiri di Root Ekosistem.**
Kalau ia tidak ada di layar, tiga langkah di atas tidak berarti apa-apa.

Lapor balik juga:
- `lsof -iTCP:9900 -sTCP:LISTEN` (setelah Tahap 2) — listen di IP Tailscale
- `grep -c '^A2A_BEARER_TOKEN=' ~/.hermes/.env` → 1 ; `plutil -lint` → OK

---

## Checklist status akhir yang akan cloud verifikasi dari sisi server

- [ ] `/presence` menyebut `mac` dengan `online: true`
- [ ] `/policy` menempatkan `mac` di `mac/root` dengan `grantedBy: "home"`
- [ ] Karakter **mac** TERLIHAT berdiri di Root Ekosistem pada tab 💻 Mac
- [ ] Event `a2a_task_in` muncul saat ada aktivitas A2A
- [ ] (Opsional) **Octo 🐙** versi Mac muncul saat ada git_push dari repo Mac

## Catatan penting

- **Jangan pernah** menyalin token ke chat/commit/screenshot. Laporkan hanya hasil (status/exit code).
- Kalau `office-relay.log` tidak pernah terbentuk, relay akan tetap jalan: ia
  kini membuat `~/Library/Logs` bila perlu dan jatuh ke `$TMPDIR` bila tidak
  bisa. Dulu `FATAL: no OFFICE_MAC_TOKEN` ditulis ke berkas yang tidak bisa
  ditulis, sehingga token yang hilang terbaca sebagai "kantornya memang sepi".
- Kalau `launchctl kickstart` gagal karena format label, gunakan: `launchctl bootout gui/$(id -u)/ai.hermes.gateway 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.hermes.gateway.plist`
- Restart Hermes gateway lengkap (lewat dashboard LightVela untuk cloud) TIDAK diperlukan — kickstart launchd Mac cukup.
