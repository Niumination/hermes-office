/**
 * policyClient — fetches /policy and builds the sect ladder rungs.
 *
 * The ladder's altitude is the policy's own budgetHourlyUsd (see theme/sect.ts):
 * the order is never written down here, it is the policy's. This module is
 * only the fetch + the adaptation for the two kinds of viewer.
 *
 * An owner sees the real budgets, so `sectLadder()` works as designed and the
 * rungs carry dollar caps.
 *
 * A guest's /policy is redacted (SECURITY.md §3): budgets are dropped, because
 * a map of where the money can be spent is the first thing an attacker wants.
 * The ladder still has to draw *something* — the mountain IS the floor plan —
 * so for a guest the tier comes from the room's `trust` level, which the guest
 * policy does expose. Trust is a coarser ladder than budget by design: the
 * guest sees the shape of the mountain, not its price.
 *
 * Guest caps are 0 and hidden by the caller: a guest never sees a dollar in
 * this product, and `sectLadder` would have nothing truthful to put there.
 */

import type { SectRung, SectHall } from './sect'
import { SECT_HALLS, sectLadder, type PolicyRoomLike } from './sect'
import type { RoomId } from '../rooms'

/** Trust level → altitude for a guest. Coarser than budget, same direction. */
const TRUST_TIER: Record<string, number> = {
  idle: 0,
  untrusted: 1,
  standard: 2,
  privileged: 3,
}

export interface PolicySnapshot {
  /** Ladder rungs, lowest hall first — same shape for guest and owner. */
  rungs: SectRung[]
  /** Highest tier this viewer may enter. A guest sits at -1: nothing. */
  viewerTier: number
  /** True when the server redacted the budgets. Caps are 0 and must be hidden. */
  redacted: boolean
}

interface ServerRoom {
  room: string
  trust?: string
  budgetHourlyUsd?: number
}

interface ServerPolicy {
  rooms?: ServerRoom[]
  redacted?: boolean
}

/** A guest sees the mountain but may not enter any hall (the server 403s). */
const GUEST_VIEWER_TIER = -1

/**
 * Build the ladder from a fetched /policy document.
 *
 * For an owner this is a straight `sectLadder()` call. For a guest it walks
 * the rooms itself, because the redacted shape does not carry budgets and
 * `sectLadder` would return an empty ladder — every rung would silently
 * disappear, which is exactly the "a check that stops running is not a check"
 * failure this repo has already paid for once.
 */
export function ladderFromPolicy(policy: ServerPolicy): PolicySnapshot {
  const rooms = policy.rooms ?? []
  const redacted = policy.redacted === true

  if (!redacted) {
    const byId: Record<string, PolicyRoomLike> = {}
    for (const r of rooms) {
      if (typeof r.budgetHourlyUsd === 'number') byId[r.room] = { budgetHourlyUsd: r.budgetHourlyUsd }
    }
    const rungs = sectLadder(byId)
    // An owner may go anywhere the policy lets the kiosk go: the top of the
    // ladder. canEnter() is tier<=viewerTier, so the highest tier opens all.
    const top = rungs.reduce((m, r) => Math.max(m, r.tier), GUEST_VIEWER_TIER)
    return { rungs, viewerTier: top, redacted: false }
  }

  // Guest: rooms without a hall name are still dropped, same rule as the owner
  // path — a room off the mountain is off the mountain for everybody.
  const tiers = new Set<number>()
  const rungs: SectRung[] = rooms
    .map((r) => {
      const hall: SectHall | undefined = SECT_HALLS[r.room as RoomId]
      const tier = TRUST_TIER[r.trust ?? 'untrusted'] ?? TRUST_TIER.untrusted
      if (hall) tiers.add(tier)
      return { room: r.room as RoomId, hall, capUsd: 0, tier }
    })
    .filter((r): r is SectRung => Boolean(r.hall))
    // Same comparator as sectLadder(): budget is gone, so trust orders it and
    // the room id breaks ties deterministically.
    .sort((a, b) => a.tier - b.tier || a.room.localeCompare(b.room))

  return { rungs, viewerTier: GUEST_VIEWER_TIER, redacted: true }
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
