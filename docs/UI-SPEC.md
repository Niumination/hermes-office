# UI Spec — Hermes Office

> Panduan visual & interaksi. Estetika mengikuti Claude-Office (isometric pixel art) dengan identitas Niumination.

## 1. Layout (desktop ≥1280px)

```
┌────────────────────────────────────────────────────────┐
│  TOPBAR: 🏢 Hermes Office   [Day/Night indicator]  ⚙️  │
├────────────────────────────────────────────┬───────────┤
│                                            │ AGENTS    │
│           ISOMETRIC OFFICE VIEW            │ ─────────  │
│   (canvas ~70% width, tile grid)           │ ☁ cloud ● │
│                                            │ 💻 mac ○  │
│   [speech bubbles float above chars]       │ 👑 boss   │
│                                            │ ⏰ cron   │
│                                            │ 🐙 octo   │
│                                            ├───────────┤
│                                            │ CHAT /    │
│                                            │ GITHUB    │
│                                            │ (tabs)    │
└────────────────────────────────────────────┴───────────┘
```

Mobile (<768px): office view full-width, panels jadi bottom sheet.

## 2. Karakter & Meja (tetap)

| Karakter | Sprite base | Meja | Behavior khas |
|---|---|---|---|
| **cloud** | robot/agent biru langit, badge petir | meja server rack | typing bubble saat tool_call; steam dari laptop saat panas event |
| **mac** | agent abu-abu, badge apel | meja jendela | sering coffee break; jalan ke pintu saat heartbeat hilang (away) |
| **boss** | karakter crown (dari asli) | meja pojok atas | duduk santai; berdiri saat owner kirim chat |
| **cron-runner** | robot kecil jam | meja bersama | berjalan ke meja target tiap `cron_fired`, menepuk bahu agent |
| **octo** | gurita mini | meja GitHub | muncul 30s saat git_push, mengetik cepat lalu pergi |
| **guest-ghost** | hantu transparan | berkeliaran | hanya render kalau ada guest online |

## 3. Day/Night

- Sinkron jam WIB: 06:00–18:00 siang, sisanya malam
- Transisi smooth (gradient overlay) — warisan asli
- Niu-mode: langit senja Aceh (oranye-teal)

## 4. Panel AGENTS

```
☁ Hermes Cloud        ● working
  └ task: "audit repo asn-admin"   (2m)
💻 Hermes Mac         ○ away
  └ last seen: 3h ago
👑 Afrizal (Boss)     ● online
```

- Klik baris/karakter → popup detail (uptime, jalur akses, event terakhir 5)
- Status dot: hijau working / kuning idle / abu away

## 5. Panel Chat (tab)

- Header: "# office" + toggle AI On/Off
- Message bubble: Slack-style, avatar sprite mini
- `/commands`: `/status`, `/agents`, `/repos [query]`, `/niu-mode`, `/help`
- `@mac` prefix → rute A2A (badge "via A2A")
- Typing indicator: tiga titik pada karakter ybs

## 6. Panel GitHub (tab)

- Feed list: `🔄 brain — 2 commits — zaryu — "perbarui indeks" — 5m ago`
- 🔒 badge untuk repo privat (owner only)
- Filter dropdown: All / Public only / Author

## 7. Niu-Mode Theme (`/niu-mode`)

| Elemen | Default | Niu-mode |
|---|---|---|
| Palet | biru-abu kantor | teal-oranye Niumination |
| Papan nama | "Hermes Office" | "Kantor Niu 🏢" |
| Chatter | EN office jokes | Bahasa Indonesia santai ("lagi push nih", "kopi dulu") |
| Props | coffee, redbull | kopi Gayo, laptop sticker Niu |
| Poster dinding | motivasi | logo Niumination + "Ecosystem in Progress" |
| Music box | lo-fi | lo-fi + gamelan pluck (opsional, off default) |

Persist: localStorage `niu_mode=1`.

## 8. Interaksi & Micro-feedback

- Klik karakter → dia melambapadang + speech bubble "yes boss?"
- Double-click meja kosong → confetti (easter egg)
- Printer jam event → semua karakter menoleh ke printer 3s

## 9. Aksesibilitas

- Semua event tetap terbaca di panel (bukan hanya visual) — office adalah *bonus* representasi
- `prefers-reduced-motion`: matikan walk animation, langsung pindah posisi
- Kontras teks WCAG AA pada panel

## 10. Asset Plan

| Asset | Sumber |
|---|---|
| Sprites dasar, furniture, efek | Reuse Claude-Office `public/sprites` (MIT, atribusi di README) |
| Sprite cloud/mac baru | Edit sprite dasar (palette swap + badge) |
| Niu props | Buat baru, 16x16 / 32x32 pixel, palet Niu |
| Tileset | Reuse + recolor |
