#!/usr/bin/env python3
"""
check-plates.py — integrity and house-style acceptance for room plates.

WHAT THIS IS FOR, AND THE MISTAKE IT CORRECTS
---------------------------------------------
The CHANGELOG previously described a "reproducibility gap": the 18 room
plates in frontend/public/rooms/ could not be regenerated from
/home/user/art-backup/rooms/, and the restyle pipeline had been run ad hoc
and never saved as a script.

Half of that was wrong, and the wrong half mattered. There is no pipeline to
recover, because no filter could ever have produced these plates. Opening
art-backup/rooms/meeting-room.webp shows a flat rectangle with the words
"MEETING ROOM / PLACEHOLDER ART" printed in the middle. Twelve of the
sixteen backup files are placeholders like that (64-377 unique colours at
60x45, against 1711+ for every real plate). The room art was GENERATED, not
derived, and generation is not deterministic.

So the honest goal is not "make it reproducible". It is:

    You cannot reproduce generated art.
    You CAN reproduce the judgement of whether a plate belongs.

That is what this script is. It turns the one unreproducible step in the
build into a step whose *acceptance* is mechanical.

THE THREE HOLES IT CLOSES
-------------------------
1. INTEGRITY. check-assets.sh verifies that a file with the right stem
   exists. It says nothing about the contents. A plate truncated to zero
   bytes, swapped for the wrong room, or quietly re-encoded at half
   resolution passes it. Two plates have already been lost once in this
   project's history without anything noticing. Hashes close that.

2. PROVENANCE. Nothing recorded which plates are upstream art and which are
   generated, so "art-backup is the pure original, never overwrite it" was
   stated with confidence and was wrong for 12 of 16 files. The manifest
   now says, per plate, where it came from.

3. EXTENSION. "Custom policy, theming" is a paid tier feature. A customer
   adding a room needs to know what makes a plate belong. The acceptance
   checks below are that answer, in executable form.

THRESHOLDS ARE MEASURED, NOT INVENTED
-------------------------------------
Every bound here was taken from the existing corpus of 18 plates and then
loosened to the nearest round number. The placeholder test in particular
sits in a wide empty gap: real plates score 1711+ unique colours, the
placeholders top out at 377, and the line is drawn at 900.

OFF-PALETTE IS FLAGGED, NOT FAILED
----------------------------------
A magenta scan would reject nap-wellness-room (12.2%) and office-night-dm
(17.7%), and both are correct: one is a deliberate violet night mood, the
other a dusk sky through windows. A previous phase learned this the hard
way, by nearly "fixing" both. So off-palette content requires an explicit
reviewed note in the manifest rather than being silently allowed or
silently rejected. The scan is a shortlist; a human is the verdict.

USAGE
    python3 scripts/check-plates.py              # verify everything
    python3 scripts/check-plates.py --write      # regenerate the manifest
    python3 scripts/check-plates.py --candidate new-room.webp
"""
import argparse
import colorsys
import hashlib
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("FAIL: Pillow is required (pip install pillow)", file=sys.stderr)
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATE_DIR = os.path.join(ROOT, "frontend/public/rooms")
MANIFEST = os.path.join(PLATE_DIR, "PLATES.json")

# Accepted canvas sizes. New rooms use 1600x1200; the others are upstream
# shapes kept so the originals still validate.
SIZES = {(1600, 1200), (1200, 896), (2400, 1792)}
NEW_ROOM_SIZE = (1600, 1200)

MIN_BYTES, MAX_BYTES = 40 * 1024, 320 * 1024
MIN_UNIQUE = 900            # placeholders top out at 377, real plates 1711+
LUM_MEAN = (0.18, 0.62)
MAX_P5 = 0.32               # something in frame must actually be dark
MIN_P95 = 0.45              # ...and something must actually be lit
OFF_PALETTE_PCT = 3.0       # above this, the manifest must say it was reviewed


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def measure(path):
    """Palette and tone statistics, sampled small so this stays fast."""
    im = Image.open(path)
    size = im.size
    rgb = im.convert("RGB").resize((160, 120))
    raw = rgb.tobytes()
    px = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    n = len(px)

    lums, sats = [], []
    jade = gold = off = 0
    for r, g, b in px:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        deg = h * 360
        lums.append(v)
        sats.append(s)
        if s > 0.08:
            if 140 <= deg <= 200:
                jade += 1
            elif 20 <= deg <= 60:
                gold += 1
            elif 290 <= deg <= 350:
                off += 1
    lums.sort()
    tiny = Image.open(path).convert("RGB").resize((60, 45)).tobytes()
    unique = len({tiny[i:i + 3] for i in range(0, len(tiny), 3)})

    return {
        "width": size[0],
        "height": size[1],
        "bytes": os.path.getsize(path),
        "uniqueColors": unique,
        "lumMean": round(sum(lums) / n, 3),
        "lumP5": round(lums[n // 20], 3),
        "lumP95": round(lums[-n // 20], 3),
        "satMean": round(sum(sats) / n, 3),
        "jadePct": round(100 * jade / n, 1),
        "goldPct": round(100 * gold / n, 1),
        "offPalettePct": round(100 * off / n, 1),
    }


def accept(name, m, entry=None):
    """House-style checks. Returns a list of human-readable failures."""
    bad = []
    size = (m["width"], m["height"])
    if size not in SIZES:
        bad.append(f"{name}: {size[0]}x{size[1]} is not an accepted canvas size")

    if not (MIN_BYTES <= m["bytes"] <= MAX_BYTES):
        bad.append(
            f"{name}: {m['bytes'] // 1024} kB is outside {MIN_BYTES // 1024}"
            f"-{MAX_BYTES // 1024} kB — truncated, or far heavier than the corpus")

    # The check that catches someone dropping a placeholder into public/,
    # which is exactly what art-backup/ turned out to be full of.
    if m["uniqueColors"] < MIN_UNIQUE:
        bad.append(
            f"{name}: only {m['uniqueColors']} unique colours — this looks like "
            f"placeholder art, not a finished plate")

    if not (LUM_MEAN[0] <= m["lumMean"] <= LUM_MEAN[1]):
        bad.append(f"{name}: mean luminance {m['lumMean']} outside {LUM_MEAN}")
    if m["lumP5"] > MAX_P5:
        bad.append(f"{name}: nothing in frame is dark (p5 {m['lumP5']} > {MAX_P5})")
    if m["lumP95"] < MIN_P95:
        bad.append(f"{name}: nothing in frame is lit (p95 {m['lumP95']} < {MIN_P95})")

    # Flagged, not failed — see the module docstring.
    if m["offPalettePct"] > OFF_PALETTE_PCT:
        reviewed = (entry or {}).get("offPaletteReviewed")
        if not reviewed:
            bad.append(
                f"{name}: {m['offPalettePct']}% of pixels are off-palette "
                f"(magenta 290-350deg). If that is deliberate, add "
                f"\"offPaletteReviewed\" to its manifest entry saying why. "
                f"If it is not, see scripts/recolor-wash.py")
    return bad


def plates():
    """Every plate under frontend/public/rooms, including theme subfolders.

    This used to be a flat os.listdir, which meant art in a subdirectory was
    invisible to all seven rules — it could enter the repo ungated, which is
    the exact failure this file exists to prevent. Keys stay relative to
    PLATE_DIR with forward slashes, so top-level entries are unchanged and
    the existing manifest keeps matching.
    """
    found = []
    for dirpath, _dirs, files in os.walk(PLATE_DIR):
        for f in files:
            if f.lower().endswith((".webp", ".png", ".jpg")):
                rel = os.path.relpath(os.path.join(dirpath, f), PLATE_DIR)
                found.append(rel.replace(os.sep, "/"))
    return sorted(found)


def build():
    old = {}
    if os.path.exists(MANIFEST):
        old = {e["file"]: e for e in json.load(open(MANIFEST))["plates"]}
    out = []
    for f in plates():
        path = os.path.join(PLATE_DIR, f)
        prev = old.get(f, {})
        entry = {
            "file": f,
            "sha256": sha256(path),
            "origin": prev.get("origin", "generated"),
            **measure(path),
        }
        for carried in ("offPaletteReviewed", "note"):
            if carried in prev:
                entry[carried] = prev[carried]
        out.append(entry)
    doc = {
        "note": (
            "Integrity and provenance for room plates. Generated art cannot be "
            "reproduced; this records what exists and what it must look like. "
            "See docs/ROOM-PLATES.md. Regenerate with: "
            "python3 scripts/check-plates.py --write"
        ),
        "count": len(out),
        "plates": out,
    }
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"wrote {MANIFEST} — {len(out)} plates")
    return 0


def verify():
    if not os.path.exists(MANIFEST):
        print(f"FAIL: {MANIFEST} missing — run with --write", file=sys.stderr)
        return 1
    doc = json.load(open(MANIFEST))
    known = {e["file"]: e for e in doc["plates"]}
    present = set(plates())
    failures = []

    for missing in sorted(set(known) - present):
        failures.append(f"{missing}: in the manifest but not on disk")
    for extra in sorted(present - set(known)):
        failures.append(
            f"{extra}: on disk but not in the manifest — if it is a new room, "
            f"run --write and commit the result")

    for f in sorted(present & set(known)):
        path = os.path.join(PLATE_DIR, f)
        entry = known[f]
        digest = sha256(path)
        if digest != entry["sha256"]:
            failures.append(
                f"{f}: contents changed (sha256 {digest[:12]} != "
                f"{entry['sha256'][:12]}) — intentional? run --write")
            continue
        failures.extend(accept(f, measure(path), entry))

    if failures:
        print(f"FAIL: {len(failures)} problem(s) with {len(present)} room plates\n")
        for x in failures:
            print(f"  - {x}")
        return 1
    print(f"PASS: all {len(present)} room plates match their hashes and the house style")
    return 0


def candidate(path):
    if not os.path.exists(path):
        print(f"FAIL: {path} not found", file=sys.stderr)
        return 1
    m = measure(path)
    bad = accept(os.path.basename(path), m)
    print(json.dumps(m, indent=2))
    if (m["width"], m["height"]) != NEW_ROOM_SIZE:
        print(f"\nnote: new rooms should be {NEW_ROOM_SIZE[0]}x{NEW_ROOM_SIZE[1]}")
    if bad:
        print(f"\nFAIL: {len(bad)} house-style problem(s)\n")
        for x in bad:
            print(f"  - {x}")
        return 1
    print("\nPASS: this plate would fit the house style")
    return 0


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--write", action="store_true", help="regenerate the manifest")
    g.add_argument("--candidate", metavar="PATH", help="check one new plate")
    a = ap.parse_args()
    if a.write:
        return build()
    if a.candidate:
        return candidate(a.candidate)
    return verify()


if __name__ == "__main__":
    sys.exit(main())
