#!/usr/bin/env python3
"""
build-cast-sprites.py — turn the donghua cast renders into the four facing
sprites the app actually loads.

WHY MIRRORING, AND WHERE IT STOPS
---------------------------------
The app wants front-left, front-right, rear-left and rear-right for every
character. Generating all four would mean holding one identity stable across
four separate image generations, eight times over. That is exactly the failure
stylize-donghua.py was written to avoid: a character whose face changes when
it turns around is far more noticeable than a slightly simpler sprite.

So each archetype is generated twice — once from the front, once from behind —
and the left/right pair is produced by mirroring. Mirroring is free, exact, and
guarantees the two sides are the same character. It costs one thing: anything
deliberately asymmetric reads as flipped. The physician's braid swaps
shoulders, the forge-master's hammer swaps hands. At 96 px that is invisible,
and the alternative is a cast that drifts. The trade is recorded here rather
than discovered later.

WHY A FIXED CANVAS
------------------
Each render trims to a different bounding box, so pasting them straight into
the app would make characters subtly different heights and bob as they turn.
Every sprite is composited onto one canvas of fixed height with the feet on a
common baseline, so a character keeps its scale through all four facings and
across the whole cast.

USAGE
    python3 scripts/build-cast-sprites.py            # build everything ready
    python3 scripts/build-cast-sprites.py --height 256
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("FAIL: Pillow is required (pip install pillow)")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAST = os.path.join(ROOT, "art", "donghua-cast")
FRONT = os.path.join(CAST, "front-256")
REAR = os.path.join(CAST, "rear-256")
OUT = os.path.join(ROOT, "frontend", "public", "sprites", "donghua")

# archetype -> the agent roles it stands in for. The repo already ships eight
# role sprites at the top level; these are the replacements.
ROLES = {
    "cultivator": ["fullstack", "default"],
    "weaver": ["frontend"],
    "forge": ["devops"],
    "guardian": ["security"],
    "scholar": ["reviewer"],
    "alchemist": ["tester"],
    "physician": ["debugger"],
    "elder": ["manager"],
}

CANVAS_H = 256
HEADROOM = 0.04          # fraction of canvas left above the tallest sprite


def place(im, canvas_h, canvas_w):
    """Scale to fit the canvas height minus headroom, feet on the baseline."""
    target_h = int(canvas_h * (1 - HEADROOM))
    r = target_h / im.height
    im = im.resize((max(1, round(im.width * r)), target_h), Image.LANCZOS)
    out = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    out.paste(im, ((canvas_w - im.width) // 2, canvas_h - im.height), im)
    return out


def main():
    height = CANVAS_H
    if "--height" in sys.argv:
        height = int(sys.argv[sys.argv.index("--height") + 1])
    # A verifier must be able to rebuild into scratch space. Writing over the
    # art it is checking would turn a false alarm into real damage.
    out_dir = OUT
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]

    if not os.path.isdir(FRONT) or not os.path.isdir(REAR):
        print(f"FAIL: expected renders in {FRONT} and {REAR}")
        return 1

    names = sorted(
        n[:-5] for n in os.listdir(FRONT) if n.endswith(".webp"))
    if not names:
        print(f"no front renders under {FRONT}")
        return 1

    # One canvas width for the whole cast, driven by the widest render, so no
    # archetype is cropped and all of them share a coordinate system.
    widest = 0
    for n in names:
        for d in (FRONT, REAR):
            p = os.path.join(d, n + ".webp")
            if os.path.exists(p):
                with Image.open(p) as im:
                    widest = max(widest, im.width / im.height)
    canvas_w = int(height * widest * (1 - HEADROOM)) + 4

    os.makedirs(out_dir, exist_ok=True)
    built = []
    missing = []
    for n in names:
        fp = os.path.join(FRONT, n + ".webp")
        rp = os.path.join(REAR, n + ".webp")
        if not os.path.exists(rp):
            missing.append(f"{n}: has a front render but no rear")
            continue
        front = place(Image.open(fp).convert("RGBA"), height, canvas_w)
        rear = place(Image.open(rp).convert("RGBA"), height, canvas_w)
        facings = {
            "front-right": front,
            "front-left": front.transpose(Image.FLIP_LEFT_RIGHT),
            "rear-right": rear,
            "rear-left": rear.transpose(Image.FLIP_LEFT_RIGHT),
        }
        for facing, im in facings.items():
            im.save(os.path.join(out_dir, f"{n}-{facing}.webp"),
                    "WEBP", quality=92, method=6)
        built.append(n)

    total = sum(os.path.getsize(os.path.join(out_dir, f))
                for f in os.listdir(out_dir) if f.endswith(".webp"))
    print(f"built {len(built) * 4} sprites for {len(built)} archetypes "
          f"at {canvas_w}x{height} ({total / 1024:.0f} kB total)")
    for n in built:
        roles = ", ".join(ROLES.get(n, ["(unmapped)"]))
        print(f"  {n:12s} -> {roles}")

    absent = [n for n in ROLES if n not in built]
    if absent:
        print(f"\n  {len(absent)} archetype(s) not built yet: "
              f"{', '.join(sorted(absent))}")
        print("  Roles mapped to them fall back to 'cultivator' in the app.")
    for m in missing:
        print(f"  {m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
