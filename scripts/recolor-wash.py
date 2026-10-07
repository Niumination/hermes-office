#!/usr/bin/env python3
"""
recolor-wash.py — move a lighting wash from one hue family to another without
touching anything that is deliberately that colour.

WHY THIS EXISTS
---------------
`mac-studio-day.webp` came out of the donghua restyle pass with a magenta
bounce light washing its right-hand third: the wall reads 185 degrees (cyan)
on the left and 327 degrees (magenta) on the right. The source plate in
art-backup is flat slate grey, so the colour is entirely an artifact of the
restyle, not of the original art.

Magenta is not in this product's palette. Every other surface — the HUD, the
panels, the sprite rim lights, the burn states — is jade and gold. One room
glowing pink reads as a bug in a product whose entire pitch is that it is
carefully made.

WHY A FILTER AND NOT A REGENERATION
-----------------------------------
The plate's geometry is load-bearing. Furniture is composited onto room plates
at percentage coordinates, so a regenerated plate with a desk two percent to
the left silently misaligns every character standing at it. Image generation
cannot hold a layout that precisely. A hue filter changes colour and nothing
else, which is exactly the size of the problem.

WHY IT IS SELECTIVE
-------------------
A global hue rotation would also rotate the five coloured cubes on the shelf,
the red and purple of which are the whole point of that prop, plus the warm
wood of the desks. So the remap is gated two ways:

  - by hue, to a band around the offending family, and
  - by saturation, because the wash is a low-saturation veil (0.10-0.26
    measured) while the props are vivid (0.5+). Weight fades out as
    saturation rises, so a saturated magenta cube keeps its identity while
    the pale magenta haze over the wall behind it does not.

The fade is smooth. A hard threshold would leave a visible contour partway up
the wall where the wash crossed the cutoff — a worse artifact than the one
being fixed.

USAGE
    python3 scripts/recolor-wash.py IN.webp OUT.webp [--from 327] [--to 155]
                                    [--band 55] [--sat-full 0.34] [--sat-none 0.62]
"""
import argparse
import colorsys
import sys

from PIL import Image


def hue_delta(a, b):
    """Shortest signed distance from hue a to hue b, in degrees."""
    d = (b - a + 180.0) % 360.0 - 180.0
    return d


def smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def recolor(im, src_hue, dst_hue, band, sat_full, sat_none):
    im = im.convert("RGB")
    px = im.load()
    w, h = im.size
    shift = hue_delta(src_hue, dst_hue)
    touched = 0

    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            deg = hh * 360.0

            # How far inside the offending hue band is this pixel? 1 at the
            # centre, falling to 0 at the edges, so the correction tapers
            # instead of stopping dead.
            dist = abs(hue_delta(deg, src_hue))
            if dist >= band:
                continue
            w_hue = 1.0 - smoothstep(band * 0.45, band, dist)

            # Vivid pixels are props, not wash. Protect them.
            w_sat = 1.0 - smoothstep(sat_full, sat_none, ss)
            weight = w_hue * w_sat
            if weight <= 0.004:
                continue

            nh = (deg + shift * weight) % 360.0
            nr, ng, nb = colorsys.hsv_to_rgb(nh / 360.0, ss, vv)
            px[x, y] = (int(nr * 255 + 0.5), int(ng * 255 + 0.5), int(nb * 255 + 0.5))
            touched += 1

    return im, touched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--from", dest="src_hue", type=float, default=327.0)
    ap.add_argument("--to", dest="dst_hue", type=float, default=155.0)
    ap.add_argument("--band", type=float, default=55.0)
    ap.add_argument("--sat-full", type=float, default=0.34)
    ap.add_argument("--sat-none", type=float, default=0.62)
    a = ap.parse_args()

    im = Image.open(a.src)
    out, touched = recolor(im, a.src_hue, a.dst_hue, a.band, a.sat_full, a.sat_none)
    total = im.size[0] * im.size[1]
    out.save(a.dst, "WEBP", quality=92, method=6)
    print(
        f"{a.src} -> {a.dst}: {touched}/{total} px moved "
        f"({100.0 * touched / total:.1f}%), {a.src_hue:.0f}deg -> {a.dst_hue:.0f}deg"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
