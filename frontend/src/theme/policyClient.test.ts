/**
 * policyClient tests.
 *
 * There used to be two viewers here: an owner with real budgets and a guest
 * whose /policy was redacted, whose rungs had to be rebuilt from `trust`
 * because `sectLadder()` takes budgets and would otherwise have returned an
 * empty ladder — the "a check that stops running is not a check" failure
 * AGENTS.md §2 warns about. With one principal there is one path, and the
 * guarantee that still binds is that a policy carrying no budget yields no
 * standing rather than a silently empty mountain.
 */
import { describe, it, expect } from 'vitest'
import { ladderFromPolicy } from './policyClient'

const OWNER_POLICY = {
  rooms: [
    { room: 'lobby', budgetHourlyUsd: 0.25 },
    { room: 'main-office', budgetHourlyUsd: 2 },
    { room: 'meeting-room', budgetHourlyUsd: 1 },
    { room: 'server-room', budgetHourlyUsd: 5 },
    { room: 'mac-studio', budgetHourlyUsd: 3 },
    { room: 'ceo-office', budgetHourlyUsd: 10 },
    { room: 'kitchen', budgetHourlyUsd: 0 },
    { room: 'nap-room', budgetHourlyUsd: 0 },
  ],
}

describe('ladderFromPolicy — owner', () => {
  const snap = ladderFromPolicy(OWNER_POLICY)

  it('builds a rung per hall, lowest budget first', () => {
    expect(snap.rungs.map((r) => r.room)).toEqual([
      'kitchen', 'nap-room',          // $0, tie broken by room id
      'lobby',                        // $0.25
      'meeting-room',                 // $1
      'main-office',                  // $2
      'mac-studio',                   // $3
      'server-room',                  // $5
      'ceo-office',                   // $10
    ])
  })

  it('carries the real dollar caps', () => {
    const ceo = snap.rungs.find((r) => r.room === 'ceo-office')!
    expect(ceo.capUsd).toBe(10)
  })

  it('opens every hall for an owner', () => {
    expect(snap.viewerTier).toBeGreaterThanOrEqual(
      Math.max(...snap.rungs.map((r) => r.tier)),
    )
  })

  it('drops a room the policy governs but the sect has no name for', () => {
    const withBoiler = ladderFromPolicy({
      ...OWNER_POLICY,
      rooms: [...OWNER_POLICY.rooms, { room: 'boiler-room', budgetHourlyUsd: 4 }],
    })
    expect(withBoiler.rungs.map((r) => r.room)).not.toContain('boiler-room')
  })
})

describe('ladderFromPolicy — no budgets at all', () => {
  // The guest document (trust levels, no budgets) is no longer served to
  // anybody. What remains is the degenerate case: a policy that names rooms
  // but budgets none of them. The ladder must then be empty and viewerTier
  // must be -1 — opening nothing — rather than quietly granting the top rung
  // of an empty set.
  const snap = ladderFromPolicy({ rooms: [{ room: 'lobby' }, { room: 'ceo-office' }] })

  it('draws no rung it cannot place on the mountain by budget', () => {
    expect(snap.rungs).toHaveLength(0)
  })

  it('grants no standing rather than defaulting to the top', () => {
    expect(snap.viewerTier).toBe(-1)
  })

  it('still reads the occupants, so the halls are not lost with the rungs', () => {
    const s2 = ladderFromPolicy({ rooms: [{ room: 'lobby', occupants: [{ agent: 'cloud' }] }] })
    expect(s2.placements).toEqual({ cloud: 'lobby' })
  })
})

// --- placements: the server says where, the socket says when ----------------
//
// `occupants` was already arriving on the wire and was being discarded,
// which is why the mountain rendered deserted on every page load.

describe('placements', () => {
  it('reads occupants for an owner policy', () => {
    const snap = ladderFromPolicy({
      rooms: [
        { room: 'lobby', budgetHourlyUsd: 0.25, occupants: [{ agent: 'cloud' }, { agent: 'mac' }] },
        { room: 'ceo-office', budgetHourlyUsd: 10, occupants: [{ agent: 'boss' }] },
      ],
    })
    expect(snap.placements).toEqual({ cloud: 'lobby', mac: 'lobby', boss: 'ceo-office' })
  })

  it('skips rooms the mountain does not draw', () => {
    // A room with no sect hall is dropped from the ladder; seeding an agent
    // into it would mark it placed while rendering it nowhere.
    const snap = ladderFromPolicy({
      rooms: [
        { room: 'lobby', budgetHourlyUsd: 0.25, occupants: [{ agent: 'cloud' }] },
        { room: 'not-a-hall', budgetHourlyUsd: 1, occupants: [{ agent: 'ghost' }] },
      ],
    })
    expect(snap.placements).toEqual({ cloud: 'lobby' })
  })

  it('is an empty map when nobody is placed, never undefined', () => {
    // Callers iterate it unguarded; undefined here would white-screen the app.
    const snap = ladderFromPolicy({ rooms: [{ room: 'lobby', budgetHourlyUsd: 0.25 }] })
    expect(snap.placements).toEqual({})
  })

  it('ignores occupant entries with no usable agent id', () => {
    const snap = ladderFromPolicy({
      rooms: [{ room: 'lobby', budgetHourlyUsd: 0.25, occupants: [{ agent: '' }, {}, { agent: 'cloud' }] }],
    })
    expect(snap.placements).toEqual({ cloud: 'lobby' })
  })
})
