#!/usr/bin/env python3
"""Gate 14 — perceptual contrast of the sect theme, in APCA Lc.

WHY NOT WCAG 2.x
----------------
The WCAG 2.x 4.5:1 ratio is a 1998 model built around black-on-white paper.
It is known to be wrong in both directions on dark UI: it passes some dark
pairs that are genuinely hard to read and fails some that are fine. This
theme is dark by construction, so it is measured with APCA (the perceptual
model developed for WCAG 3), which accounts for polarity and for the fact
that light-on-dark needs *more* luminance separation than dark-on-light.

Lc is a signed lightness contrast, roughly 0-106. The levels used here are
the APCA authoring guidance:

    Lc 75   columns of body text
    Lc 60   larger or secondary text, sub-heads
    Lc 45   minimum for any text; critical non-text affordances
    Lc 30   disabled / decorative non-text
    Lc 15   invisibility threshold

WHAT IS COVERED, AND WHAT IS NOT
--------------------------------
Solid token pairs are checked exactly. The ladder rail is *glass*, so its
effective background depends on the room art behind it; that pair is checked
against the brightest sect plate actually on disk, measured here rather than
hard-coded, because the worst case for a frosted panel is a bright backdrop.

Not covered: text drawn on top of room art directly (there is none), and
colours produced by color-mix() with a non-transparent second colour (there
are none). If either appears, extend this file -- do not widen the levels.
"""
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, 'frontend', 'src', 'styles', 'sect.css')
PLATES = os.path.join(ROOT, 'frontend', 'public', 'rooms', 'sect')

# (foreground token, background spec, role, human description)
# Background spec is a token name, or ('glass', token, alpha) for the rail.
PAIRS = [
    ('--sect-paper', '--sect-ink-0', 'body', 'page text on the deepest surface'),
    ('--sect-paper', '--sect-ink-1', 'body', 'rail text on the rail'),
    ('--sect-paper', '--sect-ink-2', 'body', 'text on a hovered/current rung'),
    ('--sect-mist', '--sect-ink-1', 'secondary', 'cap figures and english gloss'),
    ('--sect-mist', '--sect-ink-2', 'secondary', 'gloss on a hovered rung'),
    ('--sect-mist', '--sect-ink-3', 'minimum', 'locked-hall text at its dimmest'),
    ('--sect-jade', '--sect-ink-1', 'secondary', 'jade accents on the rail'),
    ('--sect-gold', '--sect-ink-1', 'critical', 'focus ring on the rail'),
    ('--sect-gold', '--sect-ink-2', 'critical', 'current-rung marker'),
    ('--sect-cinnabar', '--sect-ink-0', 'critical', 'qi-deviation outline'),
    ('--sect-paper', ('glass', '--sect-ink-1', 0.78), 'body',
     'rail text where the rail is glass over the brightest hall'),
    ('--sect-mist', ('glass', '--sect-ink-1', 0.78), 'secondary',
     'gloss where the rail is glass over the brightest hall'),
]

LEVELS = {'body': 75.0, 'secondary': 60.0, 'critical': 45.0, 'minimum': 45.0}


# ---------- oklch -> sRGB -------------------------------------------------
def oklch_to_srgb(L, C, H):
    a = C * math.cos(math.radians(H))
    b = C * math.sin(math.radians(H))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    lin = (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
    out, clipped = [], False
    for v in lin:
        if v < -0.002 or v > 1.002:
            clipped = True
        v = min(1.0, max(0.0, v))
        v = 12.92 * v if v <= 0.0031308 else 1.055 * (v ** (1 / 2.4)) - 0.055
        out.append(min(1.0, max(0.0, v)) * 255.0)
    return tuple(out), clipped


# ---------- APCA (APCA-W3 0.1.9) -----------------------------------------
def apca_y(rgb):
    r, g, b = (c / 255.0 for c in rgb)
    return (0.2126729 * r ** 2.4 + 0.7151522 * g ** 2.4 + 0.0721750 * b ** 2.4)


def apca_lc(txt_rgb, bg_rgb):
    ytxt, ybg = apca_y(txt_rgb), apca_y(bg_rgb)
    ytxt = ytxt if ytxt > 0.022 else ytxt + (0.022 - ytxt) ** 1.414
    ybg = ybg if ybg > 0.022 else ybg + (0.022 - ybg) ** 1.414
    if abs(ybg - ytxt) < 0.0005:
        return 0.0
    if ybg > ytxt:                                    # dark text on light
        s = (ybg ** 0.56 - ytxt ** 0.57) * 1.14
        c = 0.0 if s < 0.001 else s - 0.027
    else:                                             # light text on dark
        s = (ybg ** 0.65 - ytxt ** 0.62) * 1.14
        c = 0.0 if s > -0.001 else s + 0.027
    return c * 100.0


def parse_tokens(css):
    out = {}
    for name, body in re.findall(r'(--sect-[a-z0-9-]+)\s*:\s*oklch\(([^)]+)\)', css):
        parts = body.replace('/', ' ').split()
        out[name] = (float(parts[0]), float(parts[1]), float(parts[2].rstrip('deg')))
    return out


def brightest_plate_grey():
    """sRGB grey with the same APCA luminance as the brightest sect plate."""
    try:
        from PIL import Image
    except ImportError:
        return None, 'Pillow missing'
    best, who = 0.0, None
    for fn in sorted(os.listdir(PLATES)):
        if not fn.endswith('.webp'):
            continue
        im = Image.open(os.path.join(PLATES, fn)).convert('RGB').resize((64, 48))
        raw = im.tobytes()
        px = [raw[i:i + 3] for i in range(0, len(raw), 3)]
        y = sum(apca_y(p) for p in px) / len(px)
        if y > best:
            best, who = y, fn
    if who is None:
        return None, 'no plates'
    v = best ** (1 / 2.4) * 255.0
    return (v, v, v), who


def main():
    if not os.path.exists(CSS):
        print('FAIL: %s is missing' % CSS)
        return 1
    tokens = parse_tokens(open(CSS, encoding='utf-8').read())
    missing = {t for p in PAIRS for t in (p[0], p[1] if isinstance(p[1], str) else p[1][1])}
    missing -= set(tokens)
    if missing:
        print('FAIL: sect.css defines no oklch value for: %s' % ', '.join(sorted(missing)))
        return 1

    backdrop, who = brightest_plate_grey()
    if backdrop is None:
        print('FAIL: cannot measure the glass backdrop (%s)' % who)
        return 1

    rgb = {}
    for name, (L, C, H) in tokens.items():
        srgb, clipped = oklch_to_srgb(L, C, H)
        if clipped:
            print('FAIL: %s is outside the sRGB gamut; the browser will clip it '
                  'to a colour this check did not measure' % name)
            return 1
        rgb[name] = srgb

    bad = 0
    print('APCA Lc, sect theme  (glass backdrop measured from %s)' % who)
    for fg, bgspec, role, what in PAIRS:
        if isinstance(bgspec, str):
            bg, label = rgb[bgspec], bgspec
        else:
            _, tok, alpha = bgspec
            t = rgb[tok]
            bg = tuple(alpha * t[i] + (1 - alpha) * backdrop[i] for i in range(3))
            label = '%s @%d%% over plate' % (tok, alpha * 100)
        lc = abs(apca_lc(rgb[fg], bg))
        need = LEVELS[role]
        ok = lc >= need
        bad += 0 if ok else 1
        print('  %-4s Lc %6.1f  (need %4.1f, %-9s)  %-14s on %-28s  %s'
              % ('ok' if ok else 'FAIL', lc, need, role, fg, label, what))
    if bad:
        print('\nFAIL: %d pair(s) below their APCA level. Fix the tokens in '
              'sect.css -- do not lower the levels here.' % bad)
        return 1
    print('\nPASS: %d token pairs meet their APCA level' % len(PAIRS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
