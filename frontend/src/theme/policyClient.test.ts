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

  it('publishes no viewer standing at all', () => {
    // Was 'opens every hall for an owner', asserted through `viewerTier`.
    // That field was the maximum of the ranks it was compared against, so it
    // opened everything by construction and proved nothing. Retracted and
    // inverted: the snapshot must not carry a standing for anyone.
    expect('viewerTier' in snap).toBe(false)
  })

  it('keeps a room the policy governs but no office has a name for', () => {
    // Inverted. The policy is the authority on which rooms exist and what
    // they may spend; a missing entry in a naming table is this codebase's
    // gap, not the policy's, and it must not shorten the ladder. The room
    // arrives carrying its own id as its name and a band that says plainly
    // that nobody has mapped it.
    const withBoiler = ladderFromPolicy({
      ...OWNER_POLICY,
      rooms: [...OWNER_POLICY.rooms, { room: 'boiler-room', budgetHourlyUsd: 4 }],
    })
    const rung = withBoiler.rungs.find((r) => r.room === 'boiler-room')
    expect(rung).toBeTruthy()
    expect(rung!.hall.band).toBe('Belum dipetakan')
  })
})

describe('ladderFromPolicy — no budgets at all', () => {
  // The guest document (trust levels, no budgets) is no longer served to
  // anybody. What remains is the degenerate case: a policy that names rooms
  // but budgets none of them. The ladder must then be empty, rather than
  // inventing rungs for rooms the policy gave no cap.
  const snap = ladderFromPolicy({ rooms: [{ room: 'lobby' }, { room: 'ceo-office' }] })

  it('draws no rung it cannot place on the mountain by budget', () => {
    expect(snap.rungs).toHaveLength(0)
  })

  it('grants no standing, because it has none to grant', () => {
    expect('viewerTier' in snap).toBe(false)
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

  it('keeps a placement into a room no screen can draw', () => {
    // Inverted from "skips rooms the mountain does not draw". That rule let
    // this function delete a placement the server had genuinely reported,
    // before any screen could say a word about it, and the office came out
    // emptier than the server described. Which rooms are drawable is the
    // view's decision; it cannot make it about facts it never receives.
    const snap = ladderFromPolicy({
      rooms: [
        { room: 'lobby', budgetHourlyUsd: 0.25, occupants: [{ agent: 'cloud' }] },
        { room: 'not-a-hall', budgetHourlyUsd: 1, occupants: [{ agent: 'ghost' }] },
      ],
    })
    expect(snap.placements).toEqual({ cloud: 'lobby', ghost: 'not-a-hall' })
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
