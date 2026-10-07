#!/usr/bin/env python3
"""
replay-to-gif.py — render a Time Machine replay as an animated GIF.

WHY A GIF AND NOT AN MP4
------------------------
The roadmap said "export MP4". There is no ffmpeg in this environment and
adding a binary dependency to make a sales demo prettier is a bad trade: it
breaks `npm ci && npm start` for every user who does not have it. PIL is
already a dependency of the art pipeline, writes animated GIF natively, and
produces a file that pastes into Slack, a PR, and an incident ticket without
a codec negotiation. If someone later wants MP4, one ffmpeg invocation over
the same frames does it — the hard part, which is the deterministic
reconstruction, is already done in server/replay.py's JS counterpart.

WHAT IT DRAWS
-------------
One GIF frame per replay frame. Each shows:
  - the room grid, tinted by the burn state at that moment
  - occupants listed per room
  - the governance change that produced the frame
  - a progress bar and the running spend

It deliberately does NOT draw the isometric plates or sprites. A replay knows
rooms, not coordinates (see server/replay.js), and compositing characters onto
plates at invented positions would turn evidence into a dramatisation. The
diagram look is the honest look.

USAGE
    python3 scripts/replay-to-gif.py replay.json out.gif [--ms 700] [--max 60]
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

W = 1000
MARGIN = 24
COLS = 4
CELL_H = 104
# Height is computed from the room count, not fixed: a replay touching four
# rooms rendered on a twelve-room canvas is 60% empty space, which reads as a
# deserted office rather than a small one.
def canvas_height(n_rooms, n_pending):
    rows = max(1, -(-min(n_rooms, COLS * 3) // COLS))
    return 86 + rows * (CELL_H + 12) + (46 if n_pending else 8) + 74

# Burn palette. Same five states as BURN_STATES in server/replay.js and the
# same hues as the OKLCH tokens in donghua.css — a replay that disagreed with
# the live office about what "hot" looks like would be its own bug report.
BURN = {
    "normal":   ((18, 28, 34), (90, 200, 190), "NORMAL"),
    "warm":     ((36, 30, 20), (224, 176, 84), "WARM"),
    "hot":      ((44, 26, 16), (232, 140, 60), "HOT"),
    "critical": ((48, 20, 20), (228, 88, 72), "CRITICAL"),
    "tripped":  ((20, 26, 44), (120, 150, 230), "TRIPPED"),
}

ROOM_ORDER = [
    "lobby", "main-office", "meeting-room", "manager-office",
    "ceo-office", "server-room", "mac-studio", "kitchen",
    "nap-room", "gym", "rooftop", "parking",
]


def font(size, bold=False):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else ""),
        "/usr/share/fonts/truetype/liberation/LiberationSans%s.ttf" % ("-Bold" if bold else "-Regular"),
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE, F_ROOM, F_BODY, F_SMALL = font(22, True), font(14, True), font(13), font(11)


def draw_frame(f, idx, total, rooms_seen, H):
    bg, accent, label = BURN.get(f.get("burn", "normal"), BURN["normal"])
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    # --- header ----------------------------------------------------------
    d.text((MARGIN, 18), "HERMES OFFICE — TIME MACHINE", font=F_TITLE, fill=(236, 238, 240))
    d.rectangle([W - MARGIN - 150, 20, W - MARGIN, 46], fill=accent)
    d.text((W - MARGIN - 142, 25), f"BURN: {label}", font=F_ROOM, fill=bg)

    spent = f.get("spentUsd", 0) or 0
    limit = f.get("limitUsd")
    money = f"${spent:,.2f}" + (f" / ${limit:,.2f}" if limit else "")
    # Burn state refreshes on every decision; spend only on a budget
    # transition. Printing them side by side as if simultaneous is a small
    # lie that an auditor would catch, so say how old the money is.
    # "field absent" (an older replay file) is NOT the same as "zero spend",
    # and conflating them printed "no spend recorded" over a $1.12 frame on
    # the first render of this file.
    as_of = f.get("spentAsOfSeq")
    if spent == 0 and as_of is None:
        money = "belum ada belanja tercatat"
    elif as_of is not None and as_of != f["seq"]:
        money += f"  (per seq {as_of})"
    d.text((MARGIN, 50), f"seq {f['seq']}  ·  {money}", font=F_BODY, fill=(170, 180, 190))

    # --- room grid -------------------------------------------------------
    occ = f.get("occupants", {})
    rooms = [r for r in ROOM_ORDER if r in rooms_seen] + \
            [r for r in sorted(rooms_seen) if r not in ROOM_ORDER]
    top, cell_w, cell_h = 86, (W - 2 * MARGIN - 12 * (COLS - 1)) // COLS, CELL_H

    for i, room in enumerate(rooms[: COLS * 3]):
        x = MARGIN + (i % COLS) * (cell_w + 12)
        y = top + (i // COLS) * (cell_h + 12)
        people = occ.get(room, [])
        # An occupied room is lit; an empty one is drawn but dim. Hiding empty
        # rooms would make the floor plan change shape between frames.
        border = accent if people else (70, 78, 86)
        d.rectangle([x, y, x + cell_w, y + cell_h], outline=border, width=2 if people else 1)
        if people:
            d.rectangle([x, y, x + cell_w, y + 22], fill=border)
        d.text((x + 8, y + 4), room, font=F_ROOM, fill=bg if people else (150, 158, 166))
        for j, p in enumerate(people[:4]):
            d.text((x + 10, y + 30 + j * 17), f"● {p}", font=F_BODY, fill=(236, 238, 240))
        if len(people) > 4:
            d.text((x + 10, y + 30 + 4 * 17), f"+{len(people) - 4} lagi", font=F_SMALL, fill=(170, 180, 190))

    # --- pending approvals ----------------------------------------------
    rows = max(1, -(-len(rooms[: COLS * 3]) // COLS))
    y = top + rows * (cell_h + 12) + 4
    pend = f.get("pendingApprovals", [])
    if pend:
        d.text((MARGIN, y), f"MENUNGGU PERSETUJUAN ({len(pend)})", font=F_ROOM, fill=(224, 176, 84))
        for k, a in enumerate(pend[:2]):
            d.text((MARGIN + 16, y + 20 + k * 16),
                   f"{a.get('agent')} → {a.get('tool') or a.get('kind')} @ {a.get('room')}",
                   font=F_BODY, fill=(210, 190, 150))

    # --- change line + progress -----------------------------------------
    change = f.get("change", "")
    denied = "DITOLAK" in change
    cy = H - 74
    d.rectangle([MARGIN, cy, W - MARGIN, cy + 30],
                fill=(90, 30, 30) if denied else (28, 40, 48))
    d.text((MARGIN + 10, cy + 7), change[:104], font=F_BODY,
           fill=(255, 190, 180) if denied else (220, 228, 234))

    bar_y = H - 30
    d.rectangle([MARGIN, bar_y, W - MARGIN, bar_y + 8], fill=(50, 58, 66))
    frac = (idx + 1) / max(total, 1)
    d.rectangle([MARGIN, bar_y, MARGIN + int((W - 2 * MARGIN) * frac), bar_y + 8], fill=accent)
    d.text((MARGIN, bar_y + 12), f"frame {idx + 1}/{total}", font=F_SMALL, fill=(140, 150, 160))
    return img


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    ms = int(sys.argv[sys.argv.index("--ms") + 1]) if "--ms" in sys.argv else 700
    cap = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 80

    data = json.load(open(src, encoding="utf-8"))
    frames = data.get("frames", [])
    if not frames:
        print("replay has no frames — nothing to render")
        return 1

    if len(frames) > cap:
        # Evenly spaced, endpoints kept. Mirrors sample() in server/replay.js.
        step = (len(frames) - 1) / (cap - 1)
        frames = [frames[round(i * step)] for i in range(cap)]
        print(f"note: sampled down to {cap} frames for rendering")

    rooms_seen = sorted({r for f in frames for r in f.get("occupants", {})})
    # One height for every frame — a GIF whose canvas resizes mid-playback is
    # rejected by half the viewers that will open it.
    max_pending = max((len(f.get("pendingApprovals", [])) for f in frames), default=0)
    height = canvas_height(len(rooms_seen), max_pending)
    imgs = [draw_frame(f, i, len(frames), rooms_seen, height) for i, f in enumerate(frames)]

    # Hold the last frame so the loop does not snap away from the outcome.
    durations = [ms] * len(imgs)
    durations[-1] = max(ms * 4, 2000)

    imgs[0].save(dst, save_all=True, append_images=imgs[1:], duration=durations,
                 loop=0, optimize=True)
    print(f"wrote {dst} — {len(imgs)} frames")

    chain = data.get("chain", {})
    if chain:
        v, a = chain.get("verification", {}), chain.get("anchors", {})
        print(f"provenance: chain ok={v.get('ok')} anchors={a.get('strength')} ok={a.get('ok')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
