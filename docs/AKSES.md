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

Hapus hostname publik. Sajikan kantor hanya ke tailnet:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:7333
tailscale serve status        # https://<mesin>.<tailnet>.ts.net
```

Lalu di `.env.office`:

```
OFFICE_AUTO_SESSION_CIDRS=127.0.0.1,100.64.0.0/10
```

Hasilnya: buka URL `.ts.net` dari perangkat mana pun yang tergabung tailnet
— Mac, iPhone, laptop — langsung masuk. Tanpa login, tanpa token. Dari
internet, kantor **tidak ada**; tidak ada hostname publik untuk dijangkau.

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

- **Mode 1:** host tidak teresolusi atau menolak — kantor tidak publik.
- **Mode 2:** Anda diarahkan ke halaman login Cloudflare Access, bukan ke
  kantor. Tidak ada `office_session` yang terbit.
- **Mode 3:** `200` tanpa `Set-Cookie`.

Kalau perintah itu mencetak `office_session`, kantor Anda terbuka. Tidak ada
penjelasan lain.

Gerbang otomatisnya: `scripts/check-live.sh` §2 menembak URL publik, jadi
setiap permintaannya melewati terowongan — cookie untuk permintaan itu tidak
pernah sah, berapa pun isi konfigurasi lokal.
