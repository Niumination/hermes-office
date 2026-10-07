#!/usr/bin/env python3
"""
cutout-cast.py — turn a flat-background character render into a trimmed sprite
with a clean alpha channel.

WHY A SCRIPT AND NOT A ONE-OFF
------------------------------
The donghua cast is generated art, so like the room plates it can never be
regenerated identically. What CAN be reproduced is everything downstream of
the render: the cutout, the trim, the resize. Keeping that in a script means a
customer adding their own character runs the same path we did, and the result
is comparable rather than hand-made.

WHY FLOOD FILL AND NOT A COLOUR KEY
-----------------------------------
Keying every pixel near the background colour also punches holes inside the
character wherever a shadow or a grey robe happens to match. The background is
connected to the image border and the character is not, so the fill starts
from the border and only removes what it can actually reach. A grey sash in
the middle of the figure survives; the backdrop does not.

The edge is then feathered by one pixel. Without it the cutout shows a hard
jagged rim that reads as a sticker once the sprite sits on a room plate.
"""
import os
import sys
from collections import deque

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("FAIL: Pillow is required (pip install pillow)")
    sys.exit(1)

import numpy as np

TOLERANCE = 34          # colour distance counted as background
FEATHER = 1             # px of edge softening


def cutout(src, dst, tolerance=TOLERANCE):
    im = Image.open(src).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]

    # Sample the four corners rather than assuming a value. Different render
    # runs land on slightly different greys.
    corners = [a[2, 2, :3], a[2, w - 3, :3], a[h - 3, 2, :3], a[h - 3, w - 3, :3]]
    bg = np.median(np.array(corners), axis=0)

    dist = np.sqrt(((a[..., :3] - bg) ** 2).sum(axis=2))
    candidate = dist < tolerance

    reached = np.zeros((h, w), bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                queue.append((ny, nx))

    out = a.copy()
    out[..., 3] = np.where(reached, 0, 255)
    res = Image.fromarray(out.astype(np.uint8), "RGBA")

    if FEATHER:
        alpha = res.getchannel("A").filter(ImageFilter.GaussianBlur(FEATHER))
        res.putalpha(alpha)

    box = res.getbbox()
    if box:
        res = res.crop(box)
    res.save(dst)
    return res.size, int((np.asarray(res)[..., 3] > 8).sum())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) == 2 and os.path.isfile(args[0]):
        size, px = cutout(args[0], args[1])
        print(f"  {os.path.basename(args[1])}: {size[0]}x{size[1]}, {px} opaque px")
        return 0

    root = args[0] if args else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "art", "donghua-cast")
    names = sorted(n for n in os.listdir(root)
                   if n.endswith(".png") and not n.endswith("-cut.png"))
    if not names:
        print(f"no renders under {root}")
        return 1
    for n in names:
        src = os.path.join(root, n)
        dst = os.path.join(root, n.replace(".png", "-cut.png"))
        size, px = cutout(src, dst)
        print(f"  {n:34s} -> {size[0]:4d}x{size[1]:4d}  {px:7d} opaque px")
    return 0


if __name__ == "__main__":
    sys.exit(main())
