/**
 * stations.ts — where a disciple stands on the floor.
 *
 * The pattern, and why it changed
 * -------------------------------
 * The court used to be a centred flex row along the bottom edge. Every agent
 * stood shoulder to shoulder on the same line, which read as a lineup rather
 * than an office: the room art behind them was a backdrop, not a place anyone
 * occupied.
 *
 * The-Office (booya1986) solves this by giving each agent *role* a fixed
 * station on the office grid, with the orchestrator at the centre:
 *
 *     product_manager: { x: 24, y: 12 }   // centre — ORCHESTRATOR
 *     frontend:        { x:  8, y:  8 }
 *     backend:         { x: 40, y:  8 }
 *     security:        { x:  8, y: 20 }
 *
 * Stations are stable, so an agent is always in the same place and you learn
 * the floor. That is the pattern adopted here.
 *
 * What is different here
 * ----------------------
 * Their floor is a flat tile grid drawn in PixiJS. Ours is a painted
 * isometric room, so a station needs three numbers rather than two:
 *
 *   x, y   percentage of the hall box — y is the *feet* line, not the head
 *   depth  0 = far wall, 1 = front edge
 *
 * `depth` drives scale and stacking: someone at the back is smaller and is
 * painted behind someone at the front. Without it, an agent placed near the
 * far wall looks like a giant standing on the roof. The floor polygon of the
 * donghua plates is roughly x 22-82%, y 58-92%, so the stations stay inside
 * that or they end up standing on scenery.
 *
 * Archetype, not agent id, chooses the station — the same mapping cast.ts
 * already uses for sprites. An office where `cloud` moves because someone
 * renamed it is an office you cannot learn.
 */
import type { Archetype } from './cast'

export interface Station {
  /** Percent across the hall box. */
  x: number
  /** Percent down the hall box — the standing line, i.e. the feet. */
  y: number
  /** 0 = far wall, 1 = front edge. Drives scale and paint order. */
  depth: number
}

/**
 * The elder holds the centre, like The-Office's orchestrator: the one who
 * hands out work stands where the room converges. Everyone else is placed
 * around the hall so that no two archetypes overlap at the same depth, which
 * is what keeps a full floor readable.
 */
export const STATIONS: Record<Archetype, Station> = {
  elder: { x: 50, y: 70, depth: 0.42 },
  scholar: { x: 31, y: 66, depth: 0.3 },
  guardian: { x: 69, y: 66, depth: 0.3 },
  cultivator: { x: 41, y: 80, depth: 0.72 },
  weaver: { x: 26, y: 78, depth: 0.62 },
  forge: { x: 74, y: 78, depth: 0.62 },
  alchemist: { x: 59, y: 86, depth: 0.88 },
  physician: { x: 34, y: 88, depth: 0.95 },
}

/** Where someone stands when the archetype is unknown. */
const FALLBACK: Station = { x: 50, y: 84, depth: 0.82 }

/**
 * Two disciples of the same archetype would otherwise occupy one tile. Fan
 * them sideways from the station — alternating left and right so the group
 * stays centred on the station it belongs to — and nudge depth slightly so
 * they do not z-fight.
 */
const FAN_X = 7.5
const FAN_DEPTH = 0.04

export function stationFor(
  archetype: Archetype | undefined,
  indexWithinArchetype = 0,
): Station {
  const base = (archetype && STATIONS[archetype]) || FALLBACK
  if (indexWithinArchetype === 0) return base

  const step = Math.ceil(indexWithinArchetype / 2)
  const dir = indexWithinArchetype % 2 === 1 ? -1 : 1
  return {
    x: clampPct(base.x + dir * step * FAN_X),
    y: base.y,
    depth: Math.min(1, base.depth + step * FAN_DEPTH),
  }
}

function clampPct(v: number): number {
  return Math.max(8, Math.min(92, v))
}

/**
 * Scale from depth. A figure at the far wall reads at ~78% of one at the
 * front edge — enough to sell the perspective, not so much that a back-row
 * agent becomes unreadable. Deliberately a narrow range: this is a dashboard
 * before it is a diorama, and a name you cannot read is a bug.
 */
export function scaleFor(depth: number): number {
  return 0.78 + 0.22 * Math.max(0, Math.min(1, depth))
}

/**
 * Paint order. Front figures must cover back ones, so z grows with depth.
 * Offset above the hall's own decorative layers (cloud/grade/vig sit at 2-5).
 */
export function zFor(depth: number): number {
  return 10 + Math.round(Math.max(0, Math.min(1, depth)) * 50)
}

/**
 * Assign stations to a cast, giving each archetype its own fan index.
 * Returned in paint order (back to front) so the caller can render directly.
 */
export function placeAll<T extends { archetype?: Archetype }>(
  cast: readonly T[],
): Array<T & { station: Station; scale: number; z: number }> {
  const seen = new Map<string, number>()
  return cast
    .map((c) => {
      const key = c.archetype ?? '_'
      const n = seen.get(key) ?? 0
      seen.set(key, n + 1)
      const station = stationFor(c.archetype, n)
      return { ...c, station, scale: scaleFor(station.depth), z: zFor(station.depth) }
    })
    .sort((a, b) => a.z - b.z)
}
