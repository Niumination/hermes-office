// Perguruan — the sect skin for the office.
//
// This is a *theme*, not a second room model. Room ids stay exactly what the
// server and every client already use ('server-room', not 'zhenfa'), so the
// API contract is untouched and the twelve rooms stay twelve rooms. What this
// adds is a second set of names and an altitude.
//
// The one rule that matters here: ALTITUDE IS NEVER WRITTEN DOWN. It is
// derived from the floor-plan policy's own budgetHourlyUsd. "Policy as floor
// plan" has been a product principle since Fase 3 while the floor plan was
// still a flat office; making the ladder a function of the policy is what
// turns that line from a metaphor into something a test can fail on.
//
// A room with no policy entry (parking, rooftop, gym, manager-office) is not
// a sect hall. It is not governed, so it has no standing on the mountain.

import { ROOMS, OFFICES } from '../eco/ecosystem'

export interface SectHall {
  /**
   * Hall name in Bahasa Indonesia, e.g. 'Bilik Rajah'.
   *
   * The register is deliberate. These used to be Han glyphs, and the
   * obvious way to translate them was into plain office Indonesian — "Ruang
   * Server", "Ruang CEO". That would have deleted the theme rather than
   * translated it: the whole point of the sect skin is that a room is a place
   * on a mountain with standing attached, not a meeting room with a label.
   *
   * So the vocabulary comes from Indonesian persilatan — balai, bilik,
   * padepokan, sesepuh, murid — which carries the same weight the Han carried
   * and needs no footnote for an Indonesian reader.
   */
  nameId: string
  /** Plain-English gloss, shown next to it — never instead of it */
  nameEn: string
  /** Altitude band, flavour text for the ladder rung */
  band: string
}

/**
 * Naming only. Deliberately contains no ordering, no tier and no price: if a
 * number lived here it would be a second copy of the policy, free to drift.
 *
 * The eight hand-written halls that used to live here were the fork's, and
 * six of them named nowhere. Names now come from the ecosystem model, which
 * describes the rooms the owner actually works in.
 */
function hallFor(id: string): SectHall {
  const room = ROOMS.find((r) => r.id === id)
  if (room) {
    return { nameId: room.label, nameEn: room.path, band: OFFICES[room.office].label }
  }
  /*
    A governed room no office describes. It is NOT dropped: the policy is the
    authority on which rooms exist and carry budget, and this file's job is to
    name them, not to overrule them. Showing the id verbatim says plainly that
    the room is real and the name is missing — the previous behaviour threw the
    room away and left the ladder quietly shorter than the policy it was built
    from.
  */
  return { nameId: id, nameEn: id, band: 'Belum dipetakan' }
}

/** The shape this needs from a policy room. Anything else is ignored. */
export interface PolicyRoomLike {
  budgetHourlyUsd?: number
}

export interface SectRung {
  room: string
  hall: SectHall
  /** Straight from the policy. Never rounded, never re-stated. */
  capUsd: number
  /**
   * 0 at the foot of the mountain and upward. Rooms on the same budget share
   * a tier, because two rooms that cost the same grant the same power — the
   * kitchen and the nap room are both idle rooms at $0, and drawing one above
   * the other would invent a hierarchy the policy does not have.
   */
  tier: number
}

/**
 * Build the ladder from a policy document, lowest hall first.
 *
 * Rooms the policy does not govern are dropped — that much is still right,
 * since the policy is what grants standing. Governed rooms this file cannot
 * name are NOT dropped any more. That rule was written as modesty ("better
 * than inventing a name") but it let a gap in one naming table shorten the
 * ladder built from the policy, which is a different and much worse edit: a
 * budgeted room simply stopped existing, with nothing on screen to say so.
 */
export function sectLadder(rooms: Record<string, PolicyRoomLike>): SectRung[] {
  const entries = Object.entries(rooms)
    .map(([id, room]) => ({
      room: id,
      hall: hallFor(id),
      capUsd: room?.budgetHourlyUsd ?? 0,
    }))
    .sort((a, b) => a.capUsd - b.capUsd || a.room.localeCompare(b.room))

  const bands = [...new Set(entries.map((e) => e.capUsd))].sort((a, b) => a - b)
  return entries.map((e) => ({ ...e, tier: bands.indexOf(e.capUsd) }))
}

/**
 * Can a viewer holding `viewerTier` enter this rung?
 *
 * The office already does this server-side, and since 9c894ba it does it in
 * one place rather than a dozen: there is no guest token and no kiosk to
 * downgrade itself, so a request either carries the owner session or gets
 * 401. This is the same rule client-side, letting the UI refuse to draw a
 * hall it would not be allowed to read — rather than drawing it and hoping
 * the fetch fails.
 */
export function canEnter(rung: SectRung, viewerTier: number): boolean {
  return rung.tier <= viewerTier
}

// ── Tenaga: names for the burn states ──────────────────────────────────
//
// The office already has five burn states and the hall atmosphere already reacts
// to them. The sect theme must NOT introduce a second scale — two ladders for
// one quantity is how a UI starts lying. So this renames, and nothing else.
//
// Typed as a total Record over BurnState on purpose: add a sixth burn
// state and this stops compiling, which is cheaper than shipping a state with
// no name. The xianxia term for the last rung describes qi turning on its
// owner. Indonesian persilatan already has the phrase for it: 'salah jalan',
// the cultivator whose own power has gone wrong. That is what a tripped
// budget is, and it needed translating rather than transliterating.

import type { BurnState } from '../hermes/burnTypes'

export interface QiName {
  nameId: string
  nameEn: string
}

export const QI_NAMES: Record<BurnState, QiName> = {
  normal: { nameId: 'Atur Napas', nameEn: 'regulated' },
  warm: { nameId: 'Himpun Tenaga', nameEn: 'gathering' },
  hot: { nameId: 'Tenaga Meluap', nameEn: 'surging' },
  critical: { nameId: 'Tenaga Berbalik', nameEn: 'reversal' },
  tripped: { nameId: 'Salah Jalan', nameEn: 'deviation' },
}
