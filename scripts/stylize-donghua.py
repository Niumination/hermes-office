#!/usr/bin/env python3
"""
stylize-donghua.py — give the existing character sprites a donghua 3D-CG finish
without regenerating them.

WHY PROGRAMMATIC AND NOT IMAGE-GEN
----------------------------------
There are 108 character sprites under office/characters (27 characters x 4
facings) plus 42 more under characters/. Regenerating them would have
to hold one identity stable across four viewing angles, 27 times over, and
image-generation does not hold identity that tightly. Drift would show up as
a character whose face changes when it turns around — far more noticeable than
a slightly less ornate sprite. A deterministic filter instead gives perfect
consistency across facings for free, and keeps the cast recognisable.

WHAT "DONGHUA" MEANS CONCRETELY HERE
------------------------------------
From the visual-language research, the signature of premium Chinese 3D-CG
animation is a specific, reproducible stack:
  1. rim light      — a bright cyan-gold edge where the silhouette turns away
                      from camera. This is the single most identifiable cue.
  2. ambient occlusion — contact darkening just inside the silhouette, which
                      reads as sculpted volume rather than a flat cut-out.
  3. specular lift  — glossy highlights pushed in the brightest regions.
  4. warm grade     — amber highlights, teal shadows, raised saturation.
  5. subtle outline — a dark keyline that separates the figure from the plate.

All five are alpha-aware: every operation is masked by the sprite's own alpha
so nothing bleeds into the transparent surround, which would show up as a halo
the moment the sprite is composited over a room.

IDEMPOTENCE, AND HOW IT USED TO FAIL
------------------------------------
Re-running is safe only because every file is restyled from a pristine original
held in ORIGINALS, never from the shipped output. That guarantee used to be
written as a hardcoded absolute path to /home/user/art-backup/sprites — a
directory that exists on exactly one machine and in no clone of this repo.

On any other machine the path resolved to nothing, so the script treated the
already-stylized shipped sprite as the pristine original, filtered it a second
time, and wrote the doubly-filtered result over the art AND into the originals
tree. The damage was unrecoverable and the script printed "originals preserved"
while doing it. The originals now live in the repo at art/originals/sprites,
and a missing original is a hard stop rather than an invitation to invent one.
"""
import os
import sys
import glob
import math
from PIL import Image, ImageFilter, ImageChops, ImageEnhance

_args = [a for a in sys.argv[1:] if not a.startswith("--")]
SRC = _args[0] if len(_args) > 0 else "frontend/public/sprites"
DST = _args[1] if len(_args) > 1 else SRC  # in place by default
# Repo-relative, so a clone can actually reproduce the art. Overridable for
# people keeping originals outside the tree, but never guessed.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGINALS = os.environ.get("SPRITE_ORIGINALS") or os.path.join(
    ROOT, "art", "originals", "sprites")
ADOPT = "--adopt" in sys.argv[1:]

# Light comes from the upper left, matching the god rays in the room plates.
# If these disagree the characters look pasted on, which is exactly the failure
# this whole pass exists to avoid.
LIGHT_DX, LIGHT_DY = -2, -3
RIM_COLOR = (150, 230, 255)      # cool cyan key
RIM_WARM = (255, 205, 130)       # warm gold bounce on the opposite edge
RIM_STRENGTH = 0.55
AO_STRENGTH = 0.38
OUTLINE_STRENGTH = 0.30
WARM_GRADE = 0.14
SAT_BOOST = 1.12
CONTRAST = 1.06


def alpha_mask(im):
    return im.getchannel("A")


def edge_band(mask, dx, dy, width=3):
    """
    The sliver of silhouette that faces a given direction.

    Shifting the alpha and subtracting recovers exactly the edge pixels on the
    side the light comes from — the geometric definition of a rim, and far
    cheaper than any normal-map estimation.
    """
    shifted = ImageChops.offset(mask, dx, dy)
    band = ImageChops.subtract(mask, shifted)
    if width > 1:
        band = band.filter(ImageFilter.GaussianBlur(width * 0.5))
        band = ImageChops.multiply(band, mask)  # never spill outside the sprite
    return band


def tint_layer(size, color):
    return Image.new("RGB", size, color)


def stylize(im):
    im = im.convert("RGBA")
    mask = alpha_mask(im)
    rgb = im.convert("RGB")
    size = im.size

    # --- 1. warm/cool grade -------------------------------------------------
    # Lift amber into the highlights and push teal into the shadows: the
    # colour signature of the style, applied before lighting so the rim reads
    # as light rather than as a colour cast.
    r, g, b = rgb.split()
    r = r.point(lambda v: min(255, int(v + WARM_GRADE * 40 * (v / 255) ** 0.6)))
    b = b.point(lambda v: min(255, int(v + WARM_GRADE * 26 * (1 - v / 255) ** 0.8)))
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Color(rgb).enhance(SAT_BOOST)
    rgb = ImageEnhance.Contrast(rgb).enhance(CONTRAST)

    # --- 2. ambient occlusion ----------------------------------------------
    # Darken just inside the whole silhouette. This is what stops the sprite
    # reading as a flat sticker once it sits on a glossy floor.
    inner = mask.filter(ImageFilter.GaussianBlur(2.2))
    ao = ImageChops.subtract(mask, inner)
    ao = ao.point(lambda v: int(v * AO_STRENGTH))
    rgb = Image.composite(ImageChops.multiply(rgb, tint_layer(size, (120, 130, 150))), rgb, ao)

    # --- 3. specular lift ---------------------------------------------------
    lum = rgb.convert("L")
    spec = lum.point(lambda v: 0 if v < 170 else int((v - 170) * 1.9))
    spec = ImageChops.multiply(spec, mask)
    rgb = ImageChops.add(rgb, Image.merge("RGB", (spec, spec, spec)).point(lambda v: int(v * 0.35)))

    # --- 4. rim light -------------------------------------------------------
    key = edge_band(mask, LIGHT_DX, LIGHT_DY, width=3).point(lambda v: int(v * RIM_STRENGTH))
    fill = edge_band(mask, -LIGHT_DX, -LIGHT_DY, width=4).point(lambda v: int(v * RIM_STRENGTH * 0.45))
    rgb = Image.composite(tint_layer(size, RIM_COLOR), rgb, key)
    rgb = Image.composite(tint_layer(size, RIM_WARM), rgb, fill)

    # --- 5. keyline ---------------------------------------------------------
    # A thin dark border, drawn from the alpha so it traces the true silhouette
    # rather than a detected edge that would break on soft hair.
    ring = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(3)))
    ring = ring.point(lambda v: int(v * OUTLINE_STRENGTH))
    rgb = Image.composite(ImageChops.multiply(rgb, tint_layer(size, (40, 48, 64))), rgb, ring)

    out = rgb.convert("RGBA")
    out.putalpha(mask)  # alpha is never touched: silhouettes stay pixel-exact
    return out


def main():
    files = sorted(glob.glob(os.path.join(SRC, "**", "*.webp"), recursive=True))
    if not files:
        print(f"no sprites under {SRC}")
        return 1

    if not os.path.isdir(ORIGINALS) and not ADOPT:
        print(f"FAIL: no originals tree at {ORIGINALS}\n\n"
              "  This script restyles from pristine originals, never from its own\n"
              "  output. Without them it would filter the shipped art a second time\n"
              "  and overwrite it. Restore art/originals/sprites, or point\n"
              "  SPRITE_ORIGINALS at your copy. Use --adopt ONLY if SRC is itself\n"
              "  untouched upstream art being registered for the first time.")
        return 1

    done = skipped = adopted = 0
    missing = []
    for f in files:
        rel = os.path.relpath(f, SRC)
        bak = os.path.join(ORIGINALS, rel)
        if not os.path.exists(bak):
            # Adopting the shipped file as its own "original" is how the art got
            # destroyed before. It now takes an explicit flag and is counted.
            if not ADOPT:
                missing.append(rel)
                continue
            os.makedirs(os.path.dirname(bak), exist_ok=True)
            Image.open(f).save(bak, "WEBP", lossless=True)
            adopted += 1
        src = Image.open(bak)
        if src.mode != "RGBA":
            skipped += 1
            continue  # opaque tiles (floors, props without alpha) are left alone
        out = stylize(src)
        tgt = os.path.join(DST, rel)
        os.makedirs(os.path.dirname(tgt), exist_ok=True)
        out.save(tgt, "WEBP", quality=90, method=6)
        done += 1

    print(f"stylized {done} sprites from originals in {ORIGINALS}")
    if skipped:
        print(f"  {skipped} skipped (no alpha channel)")
    if adopted:
        print(f"  {adopted} adopted as new originals (--adopt)")
    if missing:
        print(f"\n  {len(missing)} sprites have no recorded original and were left "
              f"untouched:")
        for m in missing[:5]:
            print(f"    {m}")
        if len(missing) > 5:
            print(f"    ... and {len(missing) - 5} more")
        print("  These have never been through the pipeline. If they are pristine\n"
              "  upstream art, re-run with --adopt to register them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
