#!/usr/bin/env python3
"""denyut.py — denyut hidup untuk Hermes Office.

Kenapa berkas ini ada
---------------------
`hermes_emit.py` mengirim peristiwa saat ada yang terjadi. Tapi kantor
menandai agen luring setelah 90 detik tanpa kabar (`OFFICE_WATCHDOG_CUTOFF_MS`),
dan itu memang benar: presensi yang tidak pernah luruh akan berbohong tentang
siapa yang hadir.

Jadi agen yang menganggur menghilang dari balai — tepat, tapi tidak berguna
sebagai tanda "mesin ini menyala". Berkas ini mengisi celah itu: satu proses
kecil yang berkata "saya masih di sini" setiap 30 detik.

Ini BUKAN pengganti integrasi gateway. Denyut hanya membuktikan mesinnya
hidup. Untuk melihat agen benar-benar bekerja — alat apa yang dipakai, amanat
apa yang jalan — gateway harus memanggil `hermes_emit` sendiri; lihat README.

Pakai
-----
    python3 denyut.py                      # baca ~/.hermes/.env
    python3 denyut.py --agent mac --source mac
    python3 denyut.py --interval 20 --once  # satu denyut lalu keluar

Keluar 0 kalau diberhentikan dengan rapi (SIGTERM/SIGINT), 1 kalau konfigurasi
tidak lengkap. Tidak pernah ribut: kegagalan jaringan dihitung, tidak dilempar,
karena mesin yang mati jaringannya sebentar tidak boleh mematikan unit systemd.
"""

import argparse
import os
import signal
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.expanduser("~/.hermes"))

try:
    import hermes_emit as he
except ImportError:
    sys.stderr.write(
        "denyut: hermes_emit.py tidak ditemukan.\n"
        "        Letakkan di sebelah berkas ini atau di ~/.hermes/\n"
    )
    raise SystemExit(1)


_berhenti = threading.Event()


def _tangani(signum, _frame):
    # Jangan cetak dari handler sinyal lalu berharap rapi; cukup bangunkan
    # loop utama dan biarkan ia yang menutup.
    _berhenti.set()


def main(argv=None):
    p = argparse.ArgumentParser(
        prog="denyut",
        description="Kirim denyut hidup ke Hermes Office setiap N detik.",
    )
    p.add_argument("--agent", default=os.environ.get("OFFICE_AGENT", "cloud"),
                   help="nama agen yang berdenyut (bawaan: cloud)")
    p.add_argument("--source", default=os.environ.get("OFFICE_SOURCE", "cloud"),
                   help="sumber token: cloud | mac (bawaan: cloud)")
    p.add_argument("--interval", type=float,
                   default=float(os.environ.get("OFFICE_HEARTBEAT_SEC", "30")),
                   help="jeda antar denyut dalam detik (bawaan: 30)")
    p.add_argument("--state", default="idle",
                   help="status yang dilaporkan: idle | working (bawaan: idle)")
    p.add_argument("--once", action="store_true",
                   help="kirim satu denyut lalu keluar — untuk cron dan uji")
    args = p.parse_args(argv)

    # Jeda harus jauh di bawah ambang 90 detik server. 45 sudah mepet kalau
    # satu denyut hilang; 30 memberi dua kesempatan gagal sebelum agen
    # terlihat luring.
    if args.interval <= 0 or args.interval > 45:
        sys.stderr.write(
            f"denyut: --interval {args.interval} di luar jangkauan aman.\n"
            "        Kantor menandai luring setelah 90 detik, jadi pakai "
            "30 atau kurang agar satu denyut boleh hilang.\n"
        )
        return 1

    if not he.configure(source=args.source):
        sys.stderr.write(
            "denyut: OFFICE_URL / OFFICE_TOKEN belum diatur.\n"
            "        Isi ~/.hermes/.env:\n"
            "          OFFICE_URL=https://dash.abstract.biz.id\n"
            "          OFFICE_TOKEN=<token bridge>\n"
            f"          OFFICE_SOURCE={args.source}\n"
        )
        return 1

    signal.signal(signal.SIGTERM, _tangani)
    signal.signal(signal.SIGINT, _tangani)

    print(
        f"denyut: {args.agent} -> {he._s.url} setiap {args.interval:g}s "
        f"(sumber {args.source}, status {args.state})",
        flush=True,
    )

    detak = 0
    while not _berhenti.is_set():
        he.emit_agent_status(agent=args.agent, state=args.state)
        detak += 1
        if args.once:
            break
        # Event.wait, bukan sleep: SIGTERM langsung membangunkan, jadi
        # `systemctl stop` tidak menunggu sampai 30 detik berlalu.
        _berhenti.wait(args.interval)

    he.flush(timeout=6.0)
    s = he.stats()
    print(
        f"denyut: berhenti setelah {detak} detak — "
        f"terkirim {s['sent']}, gagal {s['failed']}",
        flush=True,
    )
    # Gagal kirim BUKAN kegagalan unit: kantor boleh mati tanpa menyeret
    # mesin ini ikut merah. Yang gagal hanya kalau kita tak pernah mulai.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
