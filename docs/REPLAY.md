# Time Machine — Replay (Fase 12)

Lipat perekam penerbangan ke depan dan Anda mendapat kantor sebagaimana
adanya pada momen mana pun: siapa di ruangan mana, burn state saat itu,
persetujuan apa yang menggantung, apa yang diizinkan dan ditolak.

`GET /replay?from=<ms>&to=<ms>` — owner saja.

## Apa ini BUKAN

Ini **replay tata kelola, bukan rekaman layar.** Dibangun ulang dari ledger,
jadi ia mewarisi jaminan ledger **dan** titik butanya, persis:

- **Agent punya RUANGAN, bukan koordinat.** Hanya perpindahan ruangan yang
  dicatat. Jalan kaki, istirahat kopi, gerak kecil di meja — tak satu pun ada
  di rantai, karena tak satu pun keputusan tata kelola. Replay yang mengarang
  posisi itu adalah dramatisasi yang disajikan sebagai bukti, dan itu lebih
  buruk daripada tidak ada replay.
- **Kalau ledger tidak mencatatnya, replay tidak bisa menampilkannya.** Chat,
  isi prompt, dan keluaran alat absen secara desain (SECURITY.md).
- **Replay dari rantai yang dipotong adalah replay dari rantai yang dipotong.**
  Karena itu setiap replay membawa kepala rantai, hasil `verify()`, dan vonis
  tambatan (Fase 11) **di dalam** payload, bukan di sebelahnya.

## Determinisme

Rentang ledger yang sama **wajib** menghasilkan frame yang identik byte per
byte. Artefak insiden yang berbeda antar dua kali jalan tidak bisa dipakai
sebagai bukti, dan orang pertama yang menyadarinya adalah orang yang paling
tidak Anda inginkan menyadarinya.

Tidak ada `Math.random`, tidak ada `Date.now`, tidak ada iterasi atas map
tak-berurut di dalam lipatan. Koleksi diurutkan sebelum dipancarkan. Ada test
yang membandingkan dua lipatan sebagai string.

## Pra-gulung (seeding)

Replay yang mulai pukul 02:00 tetap perlu tahu posisi semua orang pada 01:59.
Lipatan karena itu **selalu mulai dari awal rantai** dan baru mulai
*memancarkan* frame saat mencapai `from`.

Mulai dingin akan menampilkan kantor kosong yang perlahan terisi saat orang
kebetulan berpindah — artefak yang terlihat seperti evakuasi dan sepenuhnya
kesalahan rekonstruksi. `stats.seeded` melaporkan berapa record dilipat
sebagai pra-gulung.

## Kesegaran uang

Burn state diperbarui pada **setiap keputusan**; belanja terealisasi hanya
pada **transisi anggaran**. Sebuah frame karena itu bisa jujur menampilkan
`hot` di samping angka dolar dari beberapa record sebelumnya.

Itu bukan bug, tapi menyandingkan keduanya seolah terukur bersamaan adalah
kebohongan kecil yang akan ditangkap auditor. Setiap frame membawa
`spentAsOfSeq`; renderer menulis `(per seq 14)` saat angkanya basi.

## Bidang per frame

| Bidang | Isi |
|---|---|
| `seq`, `ts`, `type`, `actor` | asal record di ledger |
| `occupants` | `{ruangan: [agent]}`, **terurut dua sumbu** |
| `burn` | salah satu dari lima state |
| `spentUsd`, `limitUsd`, `spentAsOfSeq` | uang + kesegarannya |
| `pendingApprovals` | menggantung pada momen itu |
| `change` | satu baris bisa-dibaca-manusia |

`stats.truncated` menandai replay yang kena `maxFrames`. Frame dibuang dari
**ujung**, tidak pernah ditipiskan di tengah — replay yang ditipiskan tanpa
penanda adalah kebohongan tentang kontinuitas.

`sample(frames, n)` menipiskan untuk **render**, bukan untuk bukti, dan
menandai setiap frame `sampled: true`.

## Mengapa GIF, bukan MP4

Roadmap menulis "ekspor MP4". Tidak ada `ffmpeg` di lingkungan ini, dan
menambah dependensi biner demi demo yang lebih cantik adalah pertukaran yang
buruk: ia merusak `npm ci && npm start` bagi setiap pengguna yang tak
memilikinya.

PIL sudah jadi dependensi pipeline seni, menulis GIF animasi secara native,
dan menghasilkan berkas yang bisa ditempel ke Slack, PR, dan tiket insiden
tanpa negosiasi codec. Kalau nanti MP4 dibutuhkan, satu panggilan ffmpeg atas
frame yang sama cukup — bagian sulitnya, yaitu rekonstruksi deterministik,
sudah selesai.

```bash
curl -H "Authorization: Bearer $OWNER" \
     "https://office.example.com/replay?from=0" -o replay.json
python3 scripts/replay-to-gif.py replay.json insiden.gif --ms 650
```

Renderer sengaja **tidak** menggambar pelat isometrik atau sprite. Replay tahu
ruangan, bukan koordinat; menempelkan karakter pada posisi karangan akan
mengubah bukti jadi dramatisasi. Tampilan diagram adalah tampilan yang jujur.
