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
import { sectLadder, type PolicyRoomLike } from './sect'

export interface PolicySnapshot {
  /** Ladder rungs, lowest hall first. */
  rungs: SectRung[]

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
  placements: Record<string, string>
  /**
   * The hall the server drops an unplaced agent into. OPTIONAL on purpose: a
   * required field here breaks every PolicySnapshot fixture in the existing
   * tests, and this is an enrichment, not a contract.
   *
   * It is `belum-dipetakan` now, which is not a room — it is the server's
   * word for "governed, placed nowhere". It used to be 'lobby'. Callers must
   * not substitute a room of their own when this is absent: an invented
   * default is an invented location.
   */
  defaultRoom?: string
}

interface ServerRoom {
  room: string
  // `trust?: string` was here until 2026-10-17. The server stopped sending a
  // trust rung because nothing ever enforced one; parsing a field that is
  // never transmitted and never read would only keep the idea alive.
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

/**
 * agent -> room, for every placement the server reports.
 *
 * This used to skip any room missing from SECT_HALLS, justified as "the hall
 * is not rendered anyway". That filter was a silent delete: an agent the
 * server had genuinely placed vanished here, before any screen could decide
 * what to say about it, and the office looked emptier than the server said it
 * was. Deciding what can be drawn is the view's job; losing the fact is not a
 * decision anyone made on purpose.
 *
 * The room is a plain string now. The fork's RoomId union named eight halls,
 * six of which were never anywhere, so narrowing to it discarded exactly the
 * rooms worth keeping.
 */
function placementsFrom(rooms: ServerRoom[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rooms) {
    if (typeof r.room !== 'string' || !r.room) continue
    for (const o of r.occupants ?? []) {
      if (typeof o?.agent === 'string' && o.agent) out[o.agent] = r.room
    }
  }
  return out
}

export function ladderFromPolicy(policy: ServerPolicy): PolicySnapshot {
  const rooms = policy.rooms ?? []
  const placements = placementsFrom(rooms)
  const defaultRoom =
    typeof policy.defaultRoom === 'string' ? policy.defaultRoom : undefined

  const byId: Record<string, PolicyRoomLike> = {}
  for (const r of rooms) {
    if (typeof r.budgetHourlyUsd === 'number') byId[r.room] = { budgetHourlyUsd: r.budgetHourlyUsd }
  }
  const rungs = sectLadder(byId)
  // RETRACTED with `tier`: there is one owner, so there was never a second
  // standing to compare against. See the note in theme/sect.ts.
  // An empty ladder yields -1, which opens nothing — the honest answer when
  // the policy carries no budgeted room at all.
  return { rungs, placements, defaultRoom }
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
