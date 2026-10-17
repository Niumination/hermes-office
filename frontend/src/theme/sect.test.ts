import { describe, it, expect } from 'vitest'
import { sectLadder, canEnter, type PolicyRoomLike } from './sect'

// A miniature of the real floor-plan policy. Mirroring the shape rather than
// importing the server keeps this a frontend test, but the "every governed
// room has a hall" guarantee is checked against the real policy elsewhere.
const POLICY: Record<string, PolicyRoomLike> = {
  lobby: { budgetHourlyUsd: 0.25 },
  'main-office': { budgetHourlyUsd: 2 },
  'meeting-room': { budgetHourlyUsd: 1 },
  'server-room': { budgetHourlyUsd: 5 },
  'ceo-office': { budgetHourlyUsd: 10 },
  'mac-studio': { budgetHourlyUsd: 3 },
  kitchen: { budgetHourlyUsd: 0 },
  'nap-room': { budgetHourlyUsd: 0 },
}

describe('sect theme', () => {
  it('orders halls by the policy budget, not by a list in this file', () => {
    const order = sectLadder(POLICY).map((r) => r.room)
    expect(order).toEqual([
      'kitchen', 'nap-room',      // $0
      'lobby',                    // $0.25
      'meeting-room',             // $1
      'main-office',              // $2
      'mac-studio',               // $3
      'server-room',              // $5
      'ceo-office',               // $10
    ])
  })

  it('follows the policy when the policy changes', () => {
    // The whole point of deriving: move the money, the mountain moves.
    const flipped = { ...POLICY, lobby: { budgetHourlyUsd: 99 } }
    const rungs = sectLadder(flipped)
    expect(rungs[rungs.length - 1].room).toBe('lobby')
  })

  it('gives rooms on the same budget the same tier', () => {
    const byRoom = Object.fromEntries(sectLadder(POLICY).map((r) => [r.room, r.tier]))
    expect(byRoom.kitchen).toBe(byRoom['nap-room'])
    expect(byRoom.lobby).toBeGreaterThan(byRoom.kitchen)
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
    const rung = sectLadder({ infra: { budgetHourlyUsd: 2 } })[0]
    expect(rung.hall.nameId).toBe('Infrastruktur & Monitoring')
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
    const ceo = ladder.find((r) => r.room === 'ceo-office')!
    const lobby = ladder.find((r) => r.room === 'lobby')!
    expect(canEnter(lobby, 0)).toBe(false)   // tier 0 sits below $0.25
    expect(canEnter(lobby, lobby.tier)).toBe(true)
    expect(canEnter(ceo, lobby.tier)).toBe(false)
    expect(canEnter(ceo, ceo.tier)).toBe(true)
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
