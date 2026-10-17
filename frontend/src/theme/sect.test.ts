import { describe, it, expect } from 'vitest'
import { sectLadder, canEnter, type PolicyRoomLike } from './sect'

// A miniature of the real floor-plan policy. Mirroring the shape rather than
// importing the server keeps this a frontend test, but the "every governed
// room has a hall" guarantee is checked against the real policy elsewhere.
// Budgets copied from server/policy.js. Rooms are spelled `office/room`
// because the policy table is flat and `root` exists in both offices.
const POLICY: Record<string, PolicyRoomLike> = {
  'belum-dipetakan': { budgetHourlyUsd: 0.25 },
  'mac/tools': { budgetHourlyUsd: 0 },
  'mac/vault': { budgetHourlyUsd: 0 },
  'mac/labs': { budgetHourlyUsd: 0.5 },
  'mac/apps': { budgetHourlyUsd: 2 },
  'mac/root': { budgetHourlyUsd: 3 },
  'lightvela/content': { budgetHourlyUsd: 1.5 },
  'lightvela/infra': { budgetHourlyUsd: 5 },
}

describe('sect theme', () => {
  it('orders halls by the policy budget, not by a list in this file', () => {
    const order = sectLadder(POLICY).map((r) => r.room)
    expect(order).toEqual([
      'mac/tools', 'mac/vault',   // $0 — empty on the owner's instruction
      'belum-dipetakan',          // $0.25
      'mac/labs',                 // $0.5
      'lightvela/content',        // $1.5
      'mac/apps',                 // $2
      'mac/root',                 // $3
      'lightvela/infra',          // $5
    ])
  })

  it('follows the policy when the policy changes', () => {
    // The whole point of deriving: move the money, the mountain moves.
    const flipped = { ...POLICY, 'belum-dipetakan': { budgetHourlyUsd: 99 } }
    const rungs = sectLadder(flipped)
    expect(rungs[rungs.length - 1].room).toBe('belum-dipetakan')
  })

  it('gives rooms on the same budget the same tier', () => {
    const byRoom = Object.fromEntries(sectLadder(POLICY).map((r) => [r.room, r.tier]))
    expect(byRoom['mac/tools']).toBe(byRoom['mac/vault'])
    expect(byRoom['belum-dipetakan']).toBeGreaterThan(byRoom['mac/tools'])
  })

  it('leaves ungoverned rooms off the mountain', () => {
    // parking/rooftop/gym have no policy entry: not governed, not a hall.
    const rooms = sectLadder(POLICY).map((r) => r.room)
    expect(rooms).not.toContain('parking')
    expect(rooms).not.toContain('rooftop')
    expect(rooms).not.toContain('gym')
  })

  it('keeps a governed room it cannot name, and shows the id instead', () => {
    // Inverted from "drops a governed room rather than inventing a name".
    // That read as modesty and acted as deletion: a gap in the naming table
    // made a budgeted room vanish from a ladder built out of the policy, with
    // nothing on screen to admit it. The policy decides which rooms exist.
    const withUnknown = { ...POLICY, 'boiler-room': { budgetHourlyUsd: 4 } }
    const rung = sectLadder(withUnknown).find((r) => r.room === 'boiler-room')
    expect(rung).toBeTruthy()
    expect(rung!.hall.nameId).toBe('boiler-room')
    expect(rung!.hall.band).toBe('Belum dipetakan')
  })

  it('names a governed room from the ecosystem when it knows it', () => {
    const rung = sectLadder({ 'lightvela/infra': { budgetHourlyUsd: 2 } })[0]
    expect(rung.hall.nameId).toBe('Infrastruktur & Monitoring')
    expect(rung.hall.band).toBe('LightVela')
    // A bare id is no longer a room: `root` exists in both offices, so the
    // naming layer must refuse to guess which one was meant.
    const bare = sectLadder({ root: { budgetHourlyUsd: 2 } })[0]
    expect(bare.hall.nameId).toBe('root')
    expect(bare.hall.band).toBe('Belum dipetakan')
  })

  it('states no price or order of its own', () => {
    // If a number ever appears in the naming layer it is a second copy of the
    // policy, free to drift. This is the test that stops that. The names now
    // come from the ecosystem model, so that is what gets checked.
    const blob = JSON.stringify(sectLadder(POLICY).map((r) => r.hall))
    expect(blob).not.toMatch(/budget|usd|tier|\$\d/i)
  })

  it('refuses halls above the viewer tier, like the server already does', () => {
    const ladder = sectLadder(POLICY)
    const infra = ladder.find((r) => r.room === 'lightvela/infra')!
    const intake = ladder.find((r) => r.room === 'belum-dipetakan')!
    expect(canEnter(intake, 0)).toBe(false)   // tier 0 sits below $0.25
    expect(canEnter(intake, intake.tier)).toBe(true)
    expect(canEnter(infra, intake.tier)).toBe(false)
    expect(canEnter(infra, infra.tier)).toBe(true)
  })
})

describe('qi naming', () => {
  it('names every burn state the office already has', async () => {
    const { QI_NAMES } = await import('./sect')
    // Not a second scale — a renaming of the existing one. If these keys ever
    // drift from AtmosphereState, the file stops type-checking.
    expect(Object.keys(QI_NAMES).sort()).toEqual(
      ['critical', 'hot', 'normal', 'tripped', 'warm'])
  })

  it('reserves the deviation term for the tripped state', async () => {
    const { QI_NAMES } = await import('./sect')
    expect(QI_NAMES.tripped.nameId).toBe('Salah Jalan')
    expect(QI_NAMES.normal.nameId).not.toBe(QI_NAMES.tripped.nameId)
  })
})
