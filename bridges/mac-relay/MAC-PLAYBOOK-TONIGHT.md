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

## TAHAP 5 — Bukti akhir (lapor balik ke cloud)

Kumpulkan dan laporkan:
1. `lsof -iTCP:9900 -sTCP:LISTEN` (setelah Tahap 2) — listen di IP Tailscale
2. `grep -c '^A2A_BEARER_TOKEN=' ~/.hermes/.env` → 1 ; `plutil -lint` → OK
3. `launchctl list | grep office` → PID ada
4. `tail -5 ~/Library/Logs/office-relay.log` → heartbeat terkirim

---

## Checklist status akhir yang akan cloud verifikasi dari sisi server

- [ ] Karakter **Hermes Mac 💻 online** di Hermes Office (heartbeat 30s masuk)
- [ ] Event `a2a_task_in` muncul saat ada aktivitas A2A
- [ ] (Opsional) **Octo 🐙** versi Mac muncul saat ada git_push dari repo Mac

## Catatan penting

- **Jangan pernah** menyalin token ke chat/commit/screenshot. Laporkan hanya hasil (status/exit code).
- Kalau `launchctl kickstart` gagal karena format label, gunakan: `launchctl bootout gui/$(id -u)/ai.hermes.gateway 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.hermes.gateway.plist`
- Restart Hermes gateway lengkap (lewat dashboard LightVela untuk cloud) TIDAK diperlukan — kickstart launchd Mac cukup.
