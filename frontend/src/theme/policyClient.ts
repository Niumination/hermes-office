/**
 * policyClient — fetches /policy and builds the sect ladder rungs.
 *
 * The ladder's altitude is the policy's own budgetHourlyUsd (see theme/sect.ts):
 * the order is never written down here, it is the policy's. This module is
 * only the fetch and the adaptation.
 *
 * It used to have two paths. A guest's /policy was redacted — budgets
 * dropped, because a map of where the money can be spent is the first thing
 * an attacker wants — so the guest ladder was built from the room's `trust`
 * level instead, a coarser ordering with every cap forced to 0. That path is
 * gone with the guest role: /policy is owner-only and always carries real
 * budgets, so there is exactly one way to build a rung.
 */

import type { SectRung } from './sect'
import { SECT_HALLS, sectLadder, type PolicyRoomLike } from './sect'
import type { RoomId } from '../rooms'

export interface PolicySnapshot {
  /** Ladder rungs, lowest hall first. */
  rungs: SectRung[]
  /** Highest tier this viewer may enter. */
  viewerTier: number
  /**
   * Who the SERVER says is standing in each hall, agent id -> room.
   *
   * The socket carries no history, so a hall drawn only from live events is
   * empty on every page load and stays empty until something happens to move
   * — which on a quiet fleet can be minutes. The floor plan is the one place
   * that already knows, and it was being fetched and thrown away: `occupants`
   * arrives on the wire and nothing read it.
   *
   * This is the server's answer, not a guess assembled from event shapes.
   */
  placements: Record<string, RoomId>
  /**
   * The hall the server drops an unplaced agent into. OPTIONAL on purpose: a
   * required field here breaks every PolicySnapshot fixture in the existing
   * tests, and this is an enrichment, not a contract. Callers fall back to
   * 'lobby', which is what the server has always configured.
   */
  defaultRoom?: RoomId
}

interface ServerRoom {
  room: string
  trust?: string
  budgetHourlyUsd?: number
  occupants?: Array<{ agent?: string }>
  /** The server marks redaction per ROOM, not on the document — see the note
   *  in ladderFromPolicy. Declared here so callers stop casting to reach it. */
}

interface ServerPolicy {
  rooms?: ServerRoom[]
  /** Where the server places an agent it has not been told about. */
  defaultRoom?: string
}

/** No rungs at all means no standing: nothing on the mountain opens. */
const NO_STANDING = -1

/**
 * agent -> room, for every room the mountain actually draws.
 *
 * Rooms with no hall are skipped on purpose: the ladder already drops them,
 * and seeding an agent into a hall that is not rendered would put it nowhere
 * visible while still counting as "placed".
 */
function placementsFrom(rooms: ServerRoom[]): Record<string, RoomId> {
  const out: Record<string, RoomId> = {}
  for (const r of rooms) {
    if (!SECT_HALLS[r.room as RoomId]) continue
    for (const o of r.occupants ?? []) {
      if (typeof o?.agent === 'string' && o.agent) out[o.agent] = r.room as RoomId
    }
  }
  return out
}

export function ladderFromPolicy(policy: ServerPolicy): PolicySnapshot {
  const rooms = policy.rooms ?? []
  const placements = placementsFrom(rooms)
  const defaultRoom =
    typeof policy.defaultRoom === 'string' ? (policy.defaultRoom as RoomId) : undefined

  const byId: Record<string, PolicyRoomLike> = {}
  for (const r of rooms) {
    if (typeof r.budgetHourlyUsd === 'number') byId[r.room] = { budgetHourlyUsd: r.budgetHourlyUsd }
  }
  const rungs = sectLadder(byId)
  // The viewer may go anywhere the policy describes: the top of the ladder.
  // canEnter() is tier <= viewerTier, so the highest tier opens all of them.
  // An empty ladder yields -1, which opens nothing — the honest answer when
  // the policy carries no budgeted room at all.
  const top = rungs.reduce((m, r) => Math.max(m, r.tier), NO_STANDING)
  return { rungs, viewerTier: top, placements, defaultRoom }
}

/** Fetch /policy with credentials and adapt it to the ladder. Never throws:
 * the ladder is a navigation aid, not a load-bearing surface, and a failed
 * fetch must not white-screen the office. Returns null on any failure so the
 * caller can simply not render the rail. */
export async function fetchLadder(
  fetchImpl: typeof fetch = fetch,
): Promise<PolicySnapshot | null> {
  try {
    const res = await fetchImpl('/policy', { credentials: 'include' })
    if (!res.ok) return null
    return ladderFromPolicy(await res.json())
  } catch {
    return null
  }
}
