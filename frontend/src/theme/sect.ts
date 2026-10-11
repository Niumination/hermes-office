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

import type { RoomId } from '../rooms'

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
 */
export const SECT_HALLS: Partial<Record<RoomId, SectHall>> = {
  lobby: { nameId: 'Gerbang Gunung', nameEn: 'Mountain Gate', band: 'Kaki Awan' },
  'meeting-room': { nameId: 'Balai Musyawarah', nameEn: 'Council Hall', band: 'Pelataran' },
  'main-office': { nameId: 'Gelanggang Latih', nameEn: 'Cultivation Court', band: 'Teras Tengah' },
  'mac-studio': { nameId: 'Bilik Ramuan', nameEn: 'Elixir Room', band: 'Puncak Sisi' },
  'server-room': { nameId: 'Bilik Rajah', nameEn: 'Array Chamber', band: 'Gunung Dalam' },
  'ceo-office': { nameId: 'Balai Sesepuh', nameEn: 'Sect Master Hall', band: 'Puncak' },
  kitchen: { nameId: 'Balai Santap', nameEn: 'Refectory', band: 'Lereng' },
  'nap-room': { nameId: 'Bilik Hening', nameEn: 'Quiet Room', band: 'Lereng' },
}

/** The shape this needs from a policy room. Anything else is ignored. */
export interface PolicyRoomLike {
  budgetHourlyUsd?: number
}

export interface SectRung {
  room: RoomId
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
 * Rooms the policy does not govern are dropped, as are governed rooms with no
 * hall name — the second case is a gap in this file, not in the policy, and
 * it is better to leave the room off the mountain than to invent a name.
 */
export function sectLadder(rooms: Record<string, PolicyRoomLike>): SectRung[] {
  const entries = Object.entries(rooms)
    .map(([id, room]) => ({
      room: id as RoomId,
      hall: SECT_HALLS[id as RoomId],
      capUsd: room?.budgetHourlyUsd ?? 0,
    }))
    .filter((e): e is { room: RoomId; hall: SectHall; capUsd: number } => Boolean(e.hall))
    .sort((a, b) => a.capUsd - b.capUsd || a.room.localeCompare(b.room))

  const bands = [...new Set(entries.map((e) => e.capUsd))].sort((a, b) => a - b)
  return entries.map((e) => ({ ...e, tier: bands.indexOf(e.capUsd) }))
}

/**
 * Can a viewer holding `viewerTier` enter this rung?
 *
 * The office already does this server-side: a guest token gets 403 on
 * /ledger, /dossier, /standup, /approvals and /replay, and the kiosk
 * downgrades itself. This is the same rule, so the UI can refuse to draw a
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
