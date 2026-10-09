// 宗門 — the sect skin for the office.
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
  /** Hall name in Chinese, e.g. 陣法室 */
  cn: string
  /** Plain-English gloss, shown next to it — never instead of it */
  en: string
  /** Altitude band, flavour text for the ladder rung */
  band: string
}

/**
 * Naming only. Deliberately contains no ordering, no tier and no price: if a
 * number lived here it would be a second copy of the policy, free to drift.
 */
export const SECT_HALLS: Partial<Record<RoomId, SectHall>> = {
  lobby: { cn: '山門', en: 'Mountain Gate', band: '雲腳 cloud foot' },
  'meeting-room': { cn: '議事堂', en: 'Council Hall', band: '前庭 forecourt' },
  'main-office': { cn: '修煉場', en: 'Cultivation Court', band: '中階 mid terrace' },
  'mac-studio': { cn: '丹房', en: 'Elixir Room', band: '側峰 side peak' },
  'server-room': { cn: '陣法室', en: 'Array Chamber', band: '內山 inner peak' },
  'ceo-office': { cn: '掌門殿', en: 'Sect Master Hall', band: '絕頂 summit' },
  kitchen: { cn: '齋堂', en: 'Refectory', band: '山腰 hillside' },
  'nap-room': { cn: '靜室', en: 'Quiet Room', band: '山腰 hillside' },
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

// ── 氣 qi names for the burn states ────────────────────────────────────
//
// The office already has five burn states and AtmosphereLayer already reacts
// to them. The sect theme must NOT introduce a second scale — two ladders for
// one quantity is how a UI starts lying. So this renames, and nothing else.
//
// Typed as a total Record over AtmosphereState on purpose: add a sixth burn
// state and this stops compiling, which is cheaper than shipping a state with
// no name. The xianxia term is 走火入魔 (qi deviation) — excess qi turning on
// its owner — which is what a tripped budget is.

import type { AtmosphereState } from '../components/AtmosphereLayer'

export interface QiName {
  cn: string
  en: string
}

export const QI_NAMES: Record<AtmosphereState, QiName> = {
  normal: { cn: '調息', en: 'regulated' },
  warm: { cn: '聚氣', en: 'gathering' },
  hot: { cn: '氣盛', en: 'surging' },
  critical: { cn: '氣逆', en: 'reversal' },
  tripped: { cn: '走火入魔', en: 'deviation' },
}
