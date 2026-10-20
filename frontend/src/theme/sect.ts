// Perguruan — the sect skin for the office.
//
// This is a *theme*, not a second room model. Room ids stay exactly what the
// server and every client already use ('server-room', not 'zhenfa'), so the
// API contract is untouched and the twelve rooms stay twelve rooms. What this
// adds is a second set of names and an altitude.
//
// The one rule that matters here: ALTITUDE IS NEVER WRITTEN DOWN. It is
// derived from the floor-plan policy's own room list. "Policy as floor
// plan" has been a product principle since Fase 3 while the floor plan was
// still a flat office; making the ladder a function of the policy is what
// turns that line from a metaphor into something a test can fail on.
//
// A room with no policy entry (parking, rooftop, gym, manager-office) is not
// a sect hall. It is not governed, so it has no standing on the mountain.

import { OFFICES, roomByRef } from '../eco/ecosystem'

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
/**
 * The policy's default room. Not a place — the server's word for "this agent
 * is governed, but no office describes where it is". Kept in one place so the
 * spelling cannot drift away from server/policy.js.
 */
export const UNMAPPED_ROOM = 'belum-dipetakan'

function hallFor(id: string): SectHall {
  /*
    The governance layer spells a room `office/room` because `root` exists in
    both offices and its table is flat. This used to match on the bare id,
    which found `root` in whichever office happened to be listed first and
    found nothing at all once the server started namespacing.
  */
  const room = roomByRef(id)
  if (room) {
    return { nameId: room.label, nameEn: room.path, band: OFFICES[room.office].label }
  }
  /*
    The one governed room the ecosystem deliberately does not describe. The
    policy puts an agent here when it cannot say which room it belongs to, so
    naming it after a place would be the exact lie this file exists to avoid.
  */
  if (id === UNMAPPED_ROOM) {
    return { nameId: 'Belum dipetakan', nameEn: 'unplaced', band: 'Di luar kedua kantor' }
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
  /** The policy's own word for "nothing works here yet". */
  idle?: boolean
}

export interface SectRung {
  room: string
  hall: SectHall
  /** Straight from the policy. A parked room says so; it does not say "$0". */
  idle: boolean
}

/*
  RETRACTED 2026-10-17: `tier`, and `canEnter(rung, viewerTier)` with it.
  RETRACTED 2026-10-20: `capUsd`, and the ordering built on top of it.

  The trust tiers came out in 20248f2, but the idea survived here in
  disguise: rungs were ranked by budget band and that rank was called a
  tier, `viewerTier` was then defined as the HIGHEST rank present, and
  `canEnter` compared the two. A predicate that is true by construction is
  not a guarantee, it is a decoration shaped like one.

  The budget band itself is now gone too. It was never a brake: nothing in
  production ever called the check, so no ceiling ever refused anything. A
  ladder sorted by a number that governs nothing ranks rooms by fiction.
  Rungs are ordered by name, which is at least true.
*/

/**
 * Build the ladder from a policy document, in room order.
 *
 * Rooms the policy does not govern are dropped — the policy is what grants
 * standing. Governed rooms this file cannot name are NOT dropped. That rule
 * was written as modesty ("better than inventing a name") but it let a gap in
 * one naming table shorten the ladder built from the policy: a real room
 * simply stopped existing, with nothing on screen to say so.
 */
export function sectLadder(rooms: Record<string, PolicyRoomLike>): SectRung[] {
  return Object.entries(rooms)
    .map(([id, room]) => ({
      room: id,
      hall: hallFor(id),
      idle: Boolean(room?.idle),
    }))
    .sort((a, b) => a.room.localeCompare(b.room))
}
