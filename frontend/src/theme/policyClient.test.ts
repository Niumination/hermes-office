/**
 * policyClient tests — the ladder must survive the two kinds of viewer.
 *
 * The interesting case is the guest. The guest's /policy is redacted: no
 * budgets, no tool lists. `sectLadder()` takes budgets, so a naive call would
 * return an empty ladder and every rung would silently vanish — the exact
 * "a check that stops running is not a check" failure AGENTS.md §2 warns
 * about. The guest path has to build rungs from trust instead.
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
    expect(snap.redacted).toBe(false)
  })

  it('drops a room the policy governs but the sect has no name for', () => {
    const withBoiler = ladderFromPolicy({
      ...OWNER_POLICY,
      rooms: [...OWNER_POLICY.rooms, { room: 'boiler-room', budgetHourlyUsd: 4 }],
    })
    expect(withBoiler.rungs.map((r) => r.room)).not.toContain('boiler-room')
  })
})

describe('ladderFromPolicy — guest', () => {
  // What /policy actually returns for a guest: budgets gone, trust kept.
  const GUEST_POLICY = {
    redacted: true,
    rooms: [
      { room: 'lobby', trust: 'untrusted' },
      { room: 'main-office', trust: 'standard' },
      { room: 'meeting-room', trust: 'standard' },
      { room: 'server-room', trust: 'privileged' },
      { room: 'mac-studio', trust: 'privileged' },
      { room: 'ceo-office', trust: 'standard' },
      { room: 'kitchen', trust: 'idle' },
      { room: 'nap-room', trust: 'idle' },
    ],
  }

  const snap = ladderFromPolicy(GUEST_POLICY)

  it('still draws all eight halls — none silently vanish', () => {
    expect(snap.rungs).toHaveLength(8)
  })

  it('orders by trust, idle at the foot of the mountain', () => {
    const tier = (room: string) => snap.rungs.find((r) => r.room === room)!.tier
    expect(tier('kitchen')).toBe(0)
    expect(tier('lobby')).toBeGreaterThan(tier('kitchen'))
    expect(tier('server-room')).toBeGreaterThan(tier('main-office'))
  })

  it('locks every hall for a guest', () => {
    expect(snap.viewerTier).toBe(-1)
  })

  it('reports redacted so the caller can hide the caps', () => {
    expect(snap.redacted).toBe(true)
    expect(snap.rungs.every((r) => r.capUsd === 0)).toBe(true)
  })

  it('falls back to untrusted for a room with no trust level', () => {
    const snap2 = ladderFromPolicy({ redacted: true, rooms: [{ room: 'lobby' }] })
    expect(snap2.rungs).toHaveLength(1)
    expect(snap2.rungs[0].tier).toBe(1) // untrusted, above idle
  })

  it('reads redacted off the rooms when the document does not set it', () => {
    // The real server stamps `redacted: true` onto each room, not the
    // envelope. The top-level-only read silently took the owner path for a
    // guest and emptied the ladder.
    const asServed = {
      rooms: GUEST_POLICY.rooms.map((r) => ({ ...r, redacted: true })),
      ts: 1791550988984,
    }
    const snap2 = ladderFromPolicy(asServed)
    expect(snap2.redacted).toBe(true)
    expect(snap2.rungs).toHaveLength(8)
    expect(snap2.viewerTier).toBe(-1)
  })
})

// --- placements: the server says where, the socket says when ----------------
//
// `occupants` was already arriving on the wire for both viewers and was being
// discarded, which is why the mountain rendered deserted on every page load.

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

  it('reads occupants for a guest policy too', () => {
    // The guest document is redacted but keeps occupant names (server/index.js
    // GET /policy), so a guest sees a populated mountain, not an empty one.
    const snap = ladderFromPolicy({
      rooms: [
        { room: 'lobby', trust: 'untrusted', redacted: true, occupants: [{ agent: 'cloud' }] },
      ],
    })
    expect(snap.redacted).toBe(true)
    expect(snap.placements).toEqual({ cloud: 'lobby' })
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
