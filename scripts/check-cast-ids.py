#!/usr/bin/env python3
"""Gate: every agent a bridge can emit must be drawn as itself.

WHY THIS FILE EXISTS
--------------------
frontend/src/sect/cast.ts kept a table of agent id -> donghua archetype. The
table was keyed `lightvela/infra`, `mac/qa` — the office/room form. No bridge
has ever emitted that. `_slug()` in the cloud hook prefixes the topic name and
sends `lv-infra`.

So every lookup missed. Every agent fell through to the role table, where the
only role a discovered heartbeat ever carries is "generalist", and all five
LightVela agents resolved to one file: cultivator-front-left.webp. The office
drew the same character five times while the attribution underneath was
perfectly correct.

Nothing threw and nothing logged. A lookup table cannot report its own miss —
`BY_ID[id]` returning undefined is indistinguishable from a deliberate
fallback. That is the whole reason this checker is a separate program: the
miss is only visible from outside, by comparing what the bridge can produce
against what the table knows.

This is the third time the same shape of bug has been found in this repo:
`targetRoomFor()` mis-read the agent field for months, the cloud hook stamped
every event "cloud", and now the cast table could not name anyone it drew.
Each time, an attribution contract with no test. So: a gate.

WHAT IS PROVEN
--------------
  1. Every id a bridge can emit has an EXPLICIT entry in BY_ID. Falling
     through to the role table is a failure, not a default — that fallback is
     for strangers, and a mapped topic is not a stranger.
  2. No two agents that share a room are drawn with the same sprite file.
     Two identical figures side by side read as a rendering fault even when
     the data is right.
  3. Every sprite file the table can select actually exists on disk.

LIMIT, STATED HONESTLY
----------------------
Check 2 is only as true as the home map it reads, and that map lives in the
operator's environment. This gate reads the OFFICE_AGENT_HOMES line published
in docs/POLICY.md. If production boots a different value, the guarantee
covers the documented deployment and not that one. Keeping the doc honest is
therefore part of the contract, which is also why check-docs.py exists.

Run: python3 scripts/check-cast-ids.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAST = ROOT / "frontend" / "src" / "sect" / "cast.ts"
POLICY = ROOT / "docs" / "POLICY.md"
BRIDGES = ROOT / "bridges"
SPRITE_DIR = ROOT / "frontend" / "public" / "sprites"


def fail(msg: str) -> None:
    print("FAIL: cast ids")
    print(msg)
    raise SystemExit(1)


# --- the JS hash, reproduced exactly ---------------------------------------
def hash32(s: str) -> int:
    """FNV-1a as cast.ts computes it.

    Math.imul truncates to 32 bits and `>>> 0` reads the result unsigned, so
    masking after each multiply gives the identical sequence. Verified against
    node in the same change that added this file.
    """
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def sprite_for(agent_id: str, archetype: str, state: str = "idle") -> str:
    depth = "rear" if state == "away" else "front"
    side = "left" if hash32(agent_id) % 2 == 0 else "right"
    return f"donghua/{archetype}-{depth}-{side}.webp"


# --- readers ----------------------------------------------------------------
def read_by_id() -> dict[str, str]:
    """Parse the BY_ID literal out of cast.ts.

    Deliberately regex and not a JS runtime: this gate must run with python3
    alone, the way check-plates.py and check-sprites.py do, so a broken
    node_modules cannot make it skip.
    """
    src = CAST.read_text(encoding="utf-8")
    m = re.search(r"const BY_ID: Record<string, Archetype> = \{(.*?)\n\}", src, re.S)
    if not m:
        fail(f"    could not find the BY_ID table in {CAST.relative_to(ROOT)} — "
             "it was renamed or reformatted, and this gate went blind")
    body = m.group(1)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//[^\n]*", "", body)
    out = {}
    # Keys come in both spellings: bare `boss: 'elder'` for identifiers and
    # quoted `'lv-infra': 'physician'` for anything with a dash. The first
    # version of this regex only accepted the quoted form, so it silently
    # dropped the entire permanent cast — the gate reported "5 entries" for a
    # table of eleven and skipped the mac/root room completely. A parser that
    # half-reads its input is worse than one that crashes, so the sentinel
    # below makes that specific failure loud.
    pattern = r"(?:'([^']+)'|([A-Za-z_][\w-]*))\s*:\s*'([a-z]+)'"
    for quoted, bare, val in re.findall(pattern, body):
        out[quoted or bare] = val
    if not out:
        fail("    BY_ID parsed as empty — refusing to pass a check that checks nothing")
    missing = [n for n in ("boss", "cloud", "mac") if n not in out]
    if missing:
        fail(f"    BY_ID parsed, but the permanent cast is missing from the result: "
             f"{missing}.\n      Either cast.ts dropped them or this parser is only "
             f"half-reading the table.\n      Both are serious; neither may pass.")
    return out


def read_archetypes() -> list[str]:
    src = CAST.read_text(encoding="utf-8")
    m = re.search(r"export const ARCHETYPES: readonly Archetype\[\] = \[(.*?)\]", src, re.S)
    if not m:
        fail("    could not find ARCHETYPES in cast.ts")
    return re.findall(r"'([a-z]+)'", m.group(1))


def read_emittable() -> dict[str, str]:
    """Every agent name any bridge in this repo can send, and where it is from.

    Scans all bridges, not just the cloud hook, so the Mac topic hook turns
    this gate red the day it lands rather than the day someone notices ten
    identical figures.
    """
    found: dict[str, str] = {}
    for handler in sorted(BRIDGES.glob("*/handler.py")):
        src = handler.read_text(encoding="utf-8")
        rel = str(handler.relative_to(ROOT))
        m = re.search(r"AGENT_TOPICS\s*=\s*\{(.*?)\n\}", src, re.S)
        if m:
            for name in re.findall(r":\s*\"([^\"]+)\"", m.group(1)):
                found[name] = rel
        d = re.search(r"DEFAULT_AGENT\s*=\s*\"([^\"]+)\"", src)
        if d:
            found[d.group(1)] = rel
    if not found:
        fail("    no bridge declares AGENT_TOPICS — this gate would prove nothing")
    return found


def read_homes() -> dict[str, str]:
    """The OFFICE_AGENT_HOMES line published in docs/POLICY.md."""
    src = POLICY.read_text(encoding="utf-8")
    m = re.search(r"OFFICE_AGENT_HOMES='([^']+)'", src)
    if not m:
        fail("    docs/POLICY.md no longer publishes an OFFICE_AGENT_HOMES line — "
             "the room-collision check lost its input")
    homes = {}
    for entry in m.group(1).split(","):
        if "=" in entry:
            agent, room = entry.split("=", 1)
            homes[agent.strip()] = room.strip()
    return homes


# --- checks -----------------------------------------------------------------
def main() -> int:
    by_id = read_by_id()
    archetypes = set(read_archetypes())
    emittable = read_emittable()
    homes = read_homes()
    failures: list[str] = []

    # 1. no bridge-emitted name may fall through to the role table.
    for name, origin in sorted(emittable.items()):
        if name not in by_id:
            failures.append(
                f"    {name!r} can be emitted by {origin} but cast.ts has no entry.\n"
                f"      It will fall through to BY_ROLE['generalist'] and be drawn as a\n"
                f"      cultivator, same as every other unmapped agent. Add it to BY_ID."
            )

    # 2. every archetype named must be one the sprite pipeline builds.
    for name, arch in sorted(by_id.items()):
        if arch not in archetypes:
            failures.append(f"    {name!r} maps to unknown archetype {arch!r}")

    # 3. room-mates must be distinguishable.
    #
    # Compared on ARCHETYPE, not on the sprite filename. The first version of
    # this check compared filenames and passed a mutation that put two weavers
    # in Content Studio: their ids hash to opposite sides, so the files differ
    # (weaver-front-left vs weaver-front-right) while the character does not.
    # cast.ts says it plainly — left/right "means nothing whatsoever" — so a
    # test that treats the side as identity is testing the wrong thing. On
    # screen those two are twins, which is the only question being asked here.
    rooms: dict[str, list[tuple[str, str]]] = {}
    for agent, room in homes.items():
        arch = by_id.get(agent)
        if arch is None:
            continue  # covered by check 1 when it is bridge-emitted
        rooms.setdefault(room, []).append((agent, arch))
    for room, members in sorted(rooms.items()):
        seen: dict[str, str] = {}
        for agent, arch in sorted(members):
            if arch in seen:
                failures.append(
                    f"    {room}: {seen[arch]!r} and {agent!r} are both drawn as\n"
                    f"      '{arch}'. The left/right side carries no meaning, so these two\n"
                    f"      are the same figure standing side by side — give one of them\n"
                    f"      a different archetype."
                )
            seen[arch] = agent

    # 4. the files have to exist.
    for name, arch in sorted(by_id.items()):
        for state in ("idle", "away"):
            rel = sprite_for(name, arch, state)
            if not (SPRITE_DIR / rel).is_file():
                failures.append(f"    {name!r} selects /sprites/{rel}, which is not shipped")

    if failures:
        print("FAIL: cast ids")
        print("\n".join(failures))
        return 1

    drawn = len({sprite_for(a, by_id[a]) for a in homes if a in by_id})
    print(
        f"PASS: cast ids ({len(emittable)} bridge-emittable names all mapped, "
        f"{len(by_id)} entries, {len(homes)} placed agents on {len(rooms)} rooms, "
        f"{drawn} distinct sprites)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
