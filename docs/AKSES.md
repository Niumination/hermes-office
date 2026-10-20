# Akses — kantor tanpa login, tanpa celah

Dokumen ini menjawab satu pertanyaan: **bagaimana membuka
`dash.abstract.biz.id` dan langsung masuk, tanpa form login dan tanpa
menempel token, tanpa membuka kantor ke internet.**

Jawabannya bukan "jangan periksa apa-apa". Jawabannya adalah memindahkan
pemeriksaan ke tempat yang Anda tidak lihat sehari-hari.

---

## Kesalahpahaman yang harus dibereskan dulu

> "UFW hanya menerima `tailscale0`, dan terowongan Cloudflare hanya
> meneruskan `dash.abstract.biz.id`, jadi orang luar tidak sampai ke server."

Kalimat ini terdengar masuk akal dan **tidak benar**. Dua sebabnya:

**1. UFW tidak pernah melihat lalu lintas terowongan.** `cloudflared`
membuat koneksi **keluar** dari host kantor ke tepi Cloudflare. Balasan
untuk koneksi keluar adalah bagian dari sesi yang sudah terbentuk; aturan
*inbound* UFW tidak berlaku untuknya. Terowongan menembus firewall karena
memang itu gunanya — itulah alasan orang memakainya alih-alih membuka port.

**2. "Hanya meneruskan satu hostname" bukan batas identitas.** Hostname itu
ada di DNS publik. Siapa pun yang mengetiknya sampai ke kantor Anda.

Konsekuensi teknis yang paling mudah salah dibaca: karena `cloudflared`
berjalan di host yang sama, ia menyerahkan permintaan lewat loopback, jadi
**setiap pengunjung dari internet tiba di soket sebagai `127.0.0.1`** —
tidak bisa dibedakan dari browser lokal berdasarkan alamat.

Ini bukan teori. Diuji dari luar jaringan Anda: `GET /` menyerahkan cookie
owner, dan dengan cookie itu `/ledger` serta `/dossier` menjawab **200**.

---

## Tiga mode, pilih satu

Baris boot selalu mencetak mode yang aktif:
`"autoSession":"network|off"`, `"cfAccess":"on|off"`.

### Mode 1 — Tailnet saja (paling sederhana, paling aman) ✅ disarankan

Kantor sudah mendengarkan di antarmuka tailnet. Akses langsung lewat alamat
tailnet mesinnya:

```bash
tailscale ip -4              # mis. 100.71.4.9
# lalu buka http://100.71.4.9:7333 dari perangkat tailnet mana pun
```

`.env.office`:

```
OFFICE_AUTO_SESSION_CIDRS=100.64.0.0/10
```

Hasilnya: buka alamat itu dari Mac, iPhone, atau laptop yang tergabung
tailnet — langsung masuk. Tanpa login, tanpa token. Dari internet, alamat
`100.x` tidak dapat dirutekan sama sekali.

**Jangan pakai `tailscale serve` untuk jalur ini.** `tailscale serve` adalah
reverse proxy: ia menyerahkan permintaan ke `127.0.0.1` dan menambahkan
`X-Forwarded-For`, sehingga `mayAutoSession()` menolaknya — dengan benar,
karena dari sisi kantor ia tidak bisa dibedakan dari terowongan. Versi
pertama dokumen ini menyarankan `tailscale serve`, dan itu keliru. Diuji:
peer `127.0.0.1` + `X-Forwarded-For: 100.71.4.9` → **ditolak**.

**Kenapa `127.0.0.1` tidak ada di allowlist.** Terowongan Cloudflare juga
menyerahkan permintaan lewat loopback. Selama `cloudflared` selalu
menstempel `CF-Ray` dan `X-Forwarded-For` — dan ia memang selalu begitu —
memasukkan `127.0.0.1` tetap aman. Tetapi itu menggantungkan seluruh batas
pada perilaku satu program pihak ketiga. Mengeluarkannya membuat alamat
peer sendiri yang menjadi bukti, dan tidak ada lagi yang perlu dipercaya.
Yang hilang hanya kemampuan membuka kantor dari browser di VM itu sendiri.

Diuji, allowlist `100.64.0.0/10` saja:

| permintaan | hasil |
|---|---|
| peer `100.71.4.9`, tanpa header | **cookie** |
| peer `127.0.0.1`, tanpa header | ditolak |
| peer `127.0.0.1` + `CF-Ray` | ditolak |
| peer `127.0.0.1` + `X-Forwarded-For` | ditolak |

Batas keamanannya nyata karena Tailscale memverifikasi perangkat secara
kriptografis sebelum paket mencapai Anda, bukan karena ada firewall yang
kita harap menghalangi.

Catatan jujur: siapa pun yang tergabung di tailnet `archk4li` menjadi owner
penuh — bisa menempatkan agen, menyetujui amanat, membaca ledger. Hari ini
itu Anda dan Mac Anda, jadi praktis aman. Begitu ada anggota ketiga,
persempit `OFFICE_AUTO_SESSION_CIDRS` ke alamat tailnet spesifik perangkat
Anda, bukan seluruh `100.64.0.0/10`.

### Mode 2 — Tetap publik, identitas di tepi (Cloudflare Access)

Kalau `dash.abstract.biz.id` harus tetap ada, letakkan Cloudflare Access di
depannya. Access melakukan autentikasi **satu kali per perangkat**, lalu
menandatangani setiap permintaan yang diteruskannya.

Di dasbor Cloudflare Zero Trust: buat Application tipe *Self-hosted* untuk
`dash.abstract.biz.id`, kebijakan *Allow* dengan email Anda, lalu salin
**Application Audience (AUD) tag**.

```
OFFICE_CF_ACCESS_TEAM=<nama-tim>      # dari <tim>.cloudflareaccess.com
OFFICE_CF_ACCESS_AUD=<tag-aud>
# OFFICE_AUTO_SESSION_CIDRS biarkan KOSONG di mode ini
```

Kantor memverifikasi JWT dari header `Cf-Access-Jwt-Assertion`: tanda tangan
RS256 terhadap JWKS Cloudflare, `kid` yang dikenal, `aud` persis milik
aplikasi ini, `iss` milik tim ini, serta `exp`/`nbf` dengan toleransi jam
60 detik. Header tanpa tanda tangan sah tidak berarti apa-apa.

Sehari-hari Anda tidak mengetik apa pun — sesi perangkat Access bertahan
berminggu-minggu. Anda tetap punya URL publik dan tetap tidak punya form
login di kantor.

### Mode 3 — Bawaan: tidak ada auto-session

Kedua variabel kosong. Browser butuh token lewat `POST /auth/session`.
Ini bawaan karena satu-satunya default yang aman untuk server yang pintu
depannya menghadap internet.

---

## Yang tidak berubah di mode mana pun

Klien programatik tetap memakai Bearer token seperti biasa: denyut, relay
Mac, hook cloud, API. Jalur itu tidak disentuh sama sekali — yang berubah
hanya jalur browser.

`/health` tetap terbuka tanpa kredensial, karena itulah cara terowongan
tahu kantor hidup. Ia tidak memuat data kantor, hanya uptime dan hitungan.

---

## Memeriksa bahwa benar tertutup

Dari mesin **di luar** jaringan Anda — ponsel dengan data seluler, VPS,
atau sandbox mana pun:

```bash
curl -s -D- -o /dev/null https://dash.abstract.biz.id/ | grep -i set-cookie
```

- **Mode 1:** hostname publik sudah dilepas, jadi tidak ada yang menjawab.
  Kalau `dash.abstract.biz.id` masih hidup berdampingan dengan Mode 1,
  perintah di atas harus `200` **tanpa** `Set-Cookie`, dan setiap rute data
  harus `401`.
- **Mode 2:** Anda diarahkan ke halaman login Cloudflare Access, bukan ke
  kantor. Tidak ada `office_session` yang terbit.
- **Mode 3:** `200` tanpa `Set-Cookie`.

Kalau perintah itu mencetak `office_session`, kantor Anda terbuka. Tidak ada
penjelasan lain.

Gerbang otomatisnya: `scripts/check-live.sh` §2 menembak URL publik, jadi
setiap permintaannya melewati terowongan — cookie untuk permintaan itu tidak
pernah sah, berapa pun isi konfigurasi lokal.
