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
    # Dark-on-light, the only inverted pair in the theme: the selected
    # option of the theme toggle. Added the moment it was introduced --
    # a pair the designer knows about but the gate does not is worse than
    # no gate, because it buys false confidence.
    ('--sect-ink-0', '--sect-gold', 'secondary',
     'selected theme-toggle label, dark on gold'),
]

LEVELS = {'body': 75.0, 'secondary': 60.0, 'critical': 45.0, 'minimum': 45.0}

# ---------------------------------------------------------------------------
# The second palette.
#
# This block used to measure the `--ho-*` application chrome out of
# hermes.css. That stylesheet no longer exists -- the sect design system
# replaced all five of the old stylesheets, so the chrome palette it gated
# went with them.
#
# What replaced it is `body.niu-mode`, which now overrides `--sect-*` tokens
# inside sect.css itself. The gate follows the thing, not the filename: every
# pair below is measured twice, once against `:root` and once against the niu
# overrides resolved over it. A palette a user can reach with one chat command
# has to be legible, and the only way to know is to measure it rather than to
# assume the override "looks close enough".
NIU_SELECTOR = r'body\.niu-mode'


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


def _num(tok, pct_is_fraction=False):
    """Parse one oklch component.

    `oklch(13.5% 0.02 262)` and `oklch(0.135 0.02 262)` are the same colour --
    CSS accepts lightness either way. This parser accepted only the second and
    crashed with a ValueError on the first rather than failing as a red gate.
    A check that explodes on valid input is worse than one that is merely
    wrong: it stops the whole run and looks like a broken script.
    """
    tok = tok.strip()
    if tok.endswith('%'):
        v = float(tok[:-1])
        return v / 100.0 if pct_is_fraction else v
    return float(tok.rstrip('deg'))


def parse_niu_overrides(css):
    """Return the `--sect-*` tokens that `body.niu-mode` restates.

    None means the block is absent, which is a failure rather than an empty
    override: the toggle that selects this palette still exists in the UI
    either way, so a missing palette has to be loud.
    """
    m = re.search(NIU_SELECTOR + r'\s*\{([^}]*)\}', css)
    if m is None:
        return None
    out = {}
    for name, body in re.findall(
        r'(--sect-[a-z0-9-]+)\s*:\s*oklch\(([^)]+)\)', m.group(1)
    ):
        parts = body.replace('/', ' ').split()
        if len(parts) < 3:
            continue
        out[name] = (_num(parts[0], pct_is_fraction=True),
                     _num(parts[1]), _num(parts[2]))
    return out


def parse_tokens(css):
    """Read the base palette from `:root` only.

    Scoping matters: this used to scan the whole stylesheet, so when a second
    palette was added lower down, its restated tokens overwrote the base ones
    in this dict and the "default" palette was silently measured with the
    override's colours. Both palettes then reported the same numbers and the
    base one was never actually checked.
    """
    m = re.search(r'(?<![\w-]):root\s*\{(.*?)\}', css, re.S)
    block = m.group(1) if m else ''
    out = {}
    for name, body in re.findall(
        r'(--sect-[a-z0-9-]+)\s*:\s*oklch\(([^)]+)\)', block
    ):
        parts = body.replace('/', ' ').split()
        if len(parts) < 3:
            continue
        out[name] = (
            _num(parts[0], pct_is_fraction=True),   # L: 0-1, or 0-100%
            _num(parts[1]),                         # C
            _num(parts[2]),                         # H, degrees
        )
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


def measure(name, tokens, backdrop, who):
    """Measure every PAIR against one resolved palette. Returns (bad, lines)."""
    lines, bad = [], []
    rgb = {}
    for tok, (L, C, H) in tokens.items():
        srgb, clipped = oklch_to_srgb(L, C, H)
        if clipped:
            return 1, ['FAIL: %s is outside the sRGB gamut in the %s palette; '
                       'the browser will clip it to a colour this check did '
                       'not measure' % (tok, name)]
        rgb[tok] = srgb

    lines.append('')
    lines.append('APCA Lc, %s palette  (glass backdrop measured from %s)' % (name, who))
    n_bad = 0
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
        n_bad += 0 if ok else 1
        lines.append('  %-4s Lc %6.1f  (need %4.1f, %-9s)  %-14s on %-28s  %s'
                     % ('ok' if ok else 'FAIL', lc, need, role, fg, label, what))
    return n_bad, lines


def main():
    if not os.path.exists(CSS):
        print('FAIL: %s is missing' % CSS)
        return 1
    css = open(CSS, encoding='utf-8').read()
    tokens = parse_tokens(css)
    missing = {t for p in PAIRS for t in (p[0], p[1] if isinstance(p[1], str) else p[1][1])}
    missing -= set(tokens)
    if missing:
        print('FAIL: sect.css defines no oklch value for: %s' % ', '.join(sorted(missing)))
        return 1

    backdrop, who = brightest_plate_grey()
    if backdrop is None:
        print('FAIL: cannot measure the glass backdrop (%s)' % who)
        return 1

    bad = 0
    n_bad, lines = measure('default', tokens, backdrop, who)
    bad += n_bad
    for line in lines:
        print(line)

    # The niu palette is the default ladder with some rungs restated, so it is
    # resolved the way the cascade resolves it -- override merged over base --
    # rather than measured on its own. Measuring only the restated tokens would
    # silently skip every pair niu inherits, which is most of them.
    niu = parse_niu_overrides(css)
    if niu is None:
        print('')
        print('FAIL: sect.css has no %s block, but the UI still ships a toggle '
              'for it' % NIU_SELECTOR)
        bad += 1
    else:
        merged = dict(tokens)
        merged.update(niu)
        n_bad, lines = measure('niu', merged, backdrop, who)
        bad += n_bad
        for line in lines:
            print(line)

    total = 2 * len(PAIRS)
    if bad:
        print('\nFAIL: %d pair(s) below their APCA level. Fix the tokens in '
              'sect.css -- do not lower the levels here.' % bad)
        return 1
    print('\nPASS: %d token pairs meet their APCA level '
          '(%d pairs across 2 palettes)' % (total, len(PAIRS)))
    return 0

if __name__ == '__main__':
    sys.exit(main())
