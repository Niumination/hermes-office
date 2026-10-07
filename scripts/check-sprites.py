#!/usr/bin/env python3
"""
check-sprites.py — prove the shipped sprites are the ones we think they are,
and that the ones with originals can still be rebuilt from them.

WHY THIS EXISTS, AND WHY IT IS STRONGER THAN check-plates.py
------------------------------------------------------------
check-assets.sh only proves a file with the right name exists. It says nothing
about the bytes: a sprite truncated, swapped, or silently re-encoded passes.

Room plates could only ever be checked against recorded hashes, because the art
was generated and generation is not deterministic. Sprites are different. The
100 sprites that carry an original are produced by a deterministic filter, so
this checker can do what check-plates.py cannot: rebuild them from source and
demand the result match byte for byte. That is a real reproducibility
guarantee, not a recorded fingerprint.

THE THREE POPULATIONS
---------------------
  derived   — has a pristine original in art/originals/sprites, and the shipped
              file is exactly stylize(original). Fully reproducible.
  opaque    — has an original but no alpha channel, so the filter deliberately
              leaves it alone. Shipped file == original, byte for byte.
  unsourced — no original recorded. These have never been through the pipeline.
              Only their hashes protect them, exactly like room plates.

That last group is not a rounding error: 150 of 250 shipped sprites are in it,
including every character. The script's own docstring described styling "108
sprites: 27 characters x 4 facings" — office/characters holds exactly 108 files
and not one of them has ever passed through the filter. The backup ledger makes
this airtight: the pipeline copies every file it touches before touching it,
and it has never copied a character. A manifest that quietly lumped those in
with the reproducible ones would be the same kind of unexecuted claim this
repo keeps tripping over, so the three groups are counted separately and the
unsourced ones are named as such.

USAGE
    python3 scripts/check-sprites.py              # verify hashes + provenance
    python3 scripts/check-sprites.py --regen      # also rebuild derived sprites
    python3 scripts/check-sprites.py --write      # (re)record the manifest
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

try:
    from PIL import Image
except ImportError:
    # Without this the alpha probe below throws, classify() swallows it, and
    # every derived sprite is reported as provenance drift — 100 confusing
    # failures instead of one actionable line.
    print("FAIL: Pillow is required (pip install pillow)")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITE_DIR = os.path.join(ROOT, "frontend", "public", "sprites")
ORIGINALS = os.path.join(ROOT, "art", "originals", "sprites")
# The donghua cast: renders are generated art (hash-protected, like the room
# plates), but the four facings built from them are not. Resizing and
# mirroring are deterministic, so those 32 files carry the same rebuild
# guarantee as the stylized sprites — just from a different source and a
# different script.
CAST_FRONT = os.path.join(ROOT, "art", "donghua-cast", "front-256")
CAST_REAR = os.path.join(ROOT, "art", "donghua-cast", "rear-256")
CAST_PREFIX = "donghua/"
MANIFEST = os.path.join(SPRITE_DIR, "SPRITES.json")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(root):
    out = []
    for dirpath, _dirs, names in os.walk(root):
        for n in sorted(names):
            if n.endswith(".webp"):
                out.append(os.path.relpath(os.path.join(dirpath, n), root))
    return sorted(out)


def cast_source(rel):
    """For a donghua facing, the render it was built from — or None."""
    name = rel.split("/", 1)[1] if "/" in rel else rel
    stem = name[:-5] if name.endswith(".webp") else name
    for facing, where in (("-front-left", CAST_FRONT), ("-front-right", CAST_FRONT),
                          ("-rear-left", CAST_REAR), ("-rear-right", CAST_REAR)):
        if stem.endswith(facing):
            p = os.path.join(where, stem[: -len(facing)] + ".webp")
            return p if os.path.exists(p) else None
    return None


def classify(rel):
    """built | derived | opaque | unsourced — decided by the source, not the output."""
    if rel.startswith(CAST_PREFIX):
        return "built" if cast_source(rel) else "unsourced"
    orig = os.path.join(ORIGINALS, rel)
    if not os.path.exists(orig):
        return "unsourced"
    with Image.open(orig) as im:
        return "derived" if im.mode == "RGBA" else "opaque"


def build():
    entries = []
    for rel in walk(SPRITE_DIR):
        path = os.path.join(SPRITE_DIR, rel)
        kind = classify(rel)
        e = {
            "file": rel.replace(os.sep, "/"),
            "sha256": sha256(path),
            "bytes": os.path.getsize(path),
            "provenance": kind,
        }
        if kind == "built":
            e["originalSha256"] = sha256(cast_source(rel.replace(os.sep, "/")))
        elif kind != "unsourced":
            e["originalSha256"] = sha256(os.path.join(ORIGINALS, rel))
        entries.append(e)
    return entries


def write():
    entries = build()
    counts = {}
    for e in entries:
        counts[e["provenance"]] = counts.get(e["provenance"], 0) + 1
    doc = {
        "note": ("Shipped sprite inventory. 'derived' sprites are reproducible "
                 "byte-for-byte from art/originals/sprites via "
                 "scripts/stylize-donghua.py; verify with --regen. 'unsourced' "
                 "sprites have no original on record and have never been "
                 "through the pipeline — only these hashes protect them."),
        "count": len(entries),
        "byProvenance": counts,
        "sprites": entries,
    }
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"wrote {MANIFEST}")
    for k in sorted(counts):
        print(f"  {k:10s} {counts[k]}")
    return 0


def regen_built(entries, problems):
    """Rebuild every donghua facing from its cast render and demand a match.

    Resizing and mirroring are deterministic, so this is a real reproduction
    guarantee — the only thing that catches a changed canvas size or a flipped
    mirror, since every file on disk still matches its recorded hash.
    """
    built = [e for e in entries if e["provenance"] == "built"]
    if not built:
        return
    with tempfile.TemporaryDirectory(prefix="cast-regen-") as tmp:
        r = subprocess.run(
            [sys.executable,
             os.path.join(ROOT, "scripts", "build-cast-sprites.py"),
             "--out", tmp],
            capture_output=True, text=True)
        if r.returncode != 0:
            problems.append("build-cast-sprites.py failed, so the donghua cast "
                            f"could not be rebuilt:\n{r.stdout}{r.stderr}")
            return
        drift = []
        for e in built:
            name = e["file"].split("/", 1)[1]
            rebuilt = os.path.join(tmp, name)
            if not os.path.exists(rebuilt):
                drift.append(f"{e['file']}: the builder no longer produces it")
            elif sha256(rebuilt) != e["sha256"]:
                drift.append(f"{e['file']}: rebuild does not match the shipped "
                             "bytes — the build settings changed")
        if drift:
            problems.append(
                f"{len(drift)} of {len(built)} donghua sprites no longer "
                "rebuild from art/donghua-cast:")
            problems.extend("    " + d for d in drift[:8])


def regen_check(entries, problems):
    """Rebuild every derived sprite from its original and demand an exact match.

    Run into a scratch tree: a checker that writes over the art it is checking
    would turn a false alarm into real damage.
    """
    derived = [e for e in entries if e["provenance"] == "derived"]
    if not derived:
        return
    with tempfile.TemporaryDirectory(prefix="sprite-regen-") as tmp:
        r = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "stylize-donghua.py"),
             ORIGINALS, tmp],
            capture_output=True, text=True)
        if r.returncode != 0:
            problems.append("stylize-donghua.py failed, so nothing could be "
                            f"rebuilt:\n{r.stdout}{r.stderr}")
            return
        drift = []
        for e in derived:
            rebuilt = os.path.join(tmp, e["file"])
            if not os.path.exists(rebuilt):
                drift.append(f"{e['file']}: the pipeline no longer produces it")
            elif sha256(rebuilt) != e["sha256"]:
                drift.append(f"{e['file']}: rebuild does not match the shipped "
                             "bytes — the filter changed")
        if drift:
            problems.append(
                f"{len(drift)} of {len(derived)} derived sprites no longer "
                "rebuild to the shipped art:")
            problems.extend("    " + d for d in drift[:8])
            if len(drift) > 8:
                problems.append(f"    ... and {len(drift) - 8} more")


def verify(regen):
    if not os.path.exists(MANIFEST):
        print(f"FAIL: no manifest at {MANIFEST} — run with --write")
        return 1
    with open(MANIFEST, encoding="utf-8") as fh:
        doc = json.load(fh)
    recorded = {e["file"]: e for e in doc["sprites"]}
    on_disk = {p.replace(os.sep, "/") for p in walk(SPRITE_DIR)}
    problems = []

    for name in sorted(set(recorded) - on_disk):
        problems.append(f"{name}: in the manifest but not on disk")
    for name in sorted(on_disk - set(recorded)):
        problems.append(f"{name}: on disk but not in the manifest — "
                        "if it is a new sprite, re-run with --write")

    for name in sorted(set(recorded) & on_disk):
        e = recorded[name]
        path = os.path.join(SPRITE_DIR, name)
        got = sha256(path)
        if got != e["sha256"]:
            problems.append(f"{name}: contents changed "
                            f"(sha256 {got[:12]} != {e['sha256'][:12]})")
            continue
        # Provenance must not drift either. An original quietly disappearing
        # downgrades a reproducible sprite to a hash-only one, and that is the
        # kind of loss that is invisible until someone needs to rebuild.
        now = classify(name)
        if now != e["provenance"]:
            problems.append(
                f"{name}: provenance changed, {e['provenance']} -> {now}"
                + (" (its original is gone)" if now == "unsourced" else ""))
        elif e["provenance"] == "opaque" and got != e.get("originalSha256"):
            problems.append(f"{name}: has no alpha so the filter should leave "
                            "it identical to its original, but they differ")
        elif e.get("originalSha256"):
            # The original is an input, so it can rot without the shipped file
            # changing at all. --regen catches that, but only after two minutes
            # of rebuilding; the hash is already recorded, so compare it here
            # and catch source corruption in milliseconds.
            src = (cast_source(name) if e["provenance"] == "built"
                   else os.path.join(ORIGINALS, name))
            orig_now = sha256(src)
            if orig_now != e["originalSha256"]:
                problems.append(
                    f"{name}: its ORIGINAL changed "
                    f"(sha256 {orig_now[:12]} != {e['originalSha256'][:12]}) — "
                    "the shipped art is intact but can no longer be rebuilt "
                    "from source")

    if regen and not problems:
        regen_check(doc["sprites"], problems)
        regen_built(doc["sprites"], problems)

    if problems:
        print(f"FAIL: {len(problems)} sprite problem(s)\n")
        for p in problems:
            print(f"  - {p}")
        print("\nIf a change was deliberate, re-record it: "
              "python3 scripts/check-sprites.py --write")
        return 1

    c = doc["byProvenance"]
    extra = " and every reproducible sprite rebuilds exactly" if regen else ""
    print(f"PASS: all {doc['count']} sprites match their hashes{extra} "
          f"({c.get('derived', 0)} derived, {c.get('built', 0)} built, "
          f"{c.get('opaque', 0)} opaque, {c.get('unsourced', 0)} unsourced)")
    return 0


if __name__ == "__main__":
    if "--write" in sys.argv:
        sys.exit(write())
    sys.exit(verify("--regen" in sys.argv))
