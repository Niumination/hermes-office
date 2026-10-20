import { describe, it, expect } from 'vitest'
import { sectLadder, type PolicyRoomLike } from './sect'

// A miniature of the real floor-plan policy. Mirroring the shape rather than
// importing the server keeps this a frontend test, but the "every governed
// room has a hall" guarantee is checked against the real policy elsewhere.
// Rooms are spelled `office/room` because the policy table is flat and `root`
// exists in both offices.
//
// RETRACTED 2026-10-20: this fixture used to carry `budgetHourlyUsd` and the
// ladder used to be sorted by it. The whole cost layer is gone — it never
// refused anything in production — so the only thing left to order by is the
// room's own name, and `idle` is the policy's word for "nothing runs here".
const POLICY: Record<string, PolicyRoomLike> = {
  'belum-dipetakan': {},
  'mac/tools': { idle: true },
  'mac/vault': { idle: true },
  'mac/labs': {},
  'mac/apps': {},
  'mac/root': {},
  'lightvela/content': {},
  'lightvela/infra': {},
}

describe('sect theme', () => {
  it('orders halls by room id, not by a list in this file', () => {
    const order = sectLadder(POLICY).map((r) => r.room)
    expect(order).toEqual([...order].sort((a, b) => a.localeCompare(b)))
    expect(order).toEqual([
      'belum-dipetakan',
      'lightvela/content',
      'lightvela/infra',
      'mac/apps',
      'mac/labs',
      'mac/root',
      'mac/tools',
      'mac/vault',
    ])
  })

  it('follows the policy when the policy changes', () => {
    // The whole point of deriving: add a room to the policy, the mountain grows.
    const extended = { ...POLICY, 'zz/last': {} }
    const rungs = sectLadder(extended)
    expect(rungs[rungs.length - 1].room).toBe('zz/last')
  })

  it('carries the policy\u2019s own idle flag, and no number', () => {
    // Was 'orders rooms by what they may spend'. A room the owner has not
    // filled yet now says exactly that, instead of being described as costing
    // nothing per hour — a switch that means "closed" must read "closed".
    const byRoom = Object.fromEntries(sectLadder(POLICY).map((r) => [r.room, r.idle]))
    expect(byRoom['mac/tools']).toBe(true)
    expect(byRoom['mac/vault']).toBe(true)
    expect(byRoom['belum-dipetakan']).toBe(false)
    expect(byRoom['lightvela/infra']).toBe(false)
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
    // made a real room vanish from a ladder built out of the policy, with
    // nothing on screen to admit it. The policy decides which rooms exist.
    const withUnknown = { ...POLICY, 'boiler-room': {} }
    const rung = sectLadder(withUnknown).find((r) => r.room === 'boiler-room')
    expect(rung).toBeTruthy()
    expect(rung!.hall.nameId).toBe('boiler-room')
    expect(rung!.hall.band).toBe('Belum dipetakan')
  })

  it('names a governed room from the ecosystem when it knows it', () => {
    const rung = sectLadder({ 'lightvela/infra': {} })[0]
    expect(rung.hall.nameId).toBe('Infrastruktur & Monitoring')
    expect(rung.hall.band).toBe('LightVela')
    // A bare id is no longer a room: `root` exists in both offices, so the
    // naming layer must refuse to guess which one was meant.
    const bare = sectLadder({ root: {} })[0]
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

  /*
    RETRACTED, inverted: 'refuses halls above the viewer tier'.

    There is no viewer tier to be above. `canEnter` and `tier` are gone, and
    this is the check that stops them returning by the back door. Since
    2026-10-20 it also stops `capUsd` returning: a rung carries a room, a
    hall, and whether the room is parked. Nothing resembling a standing to
    clear, and nothing denominated in money.
  */
  it('publishes no standing and no price a rung could be ranked by', () => {
    const ladder = sectLadder(POLICY)
    expect(ladder.length).toBeGreaterThan(0)
    for (const rung of ladder) {
      expect(Object.keys(rung).sort()).toEqual(['hall', 'idle', 'room'])
    }
  })

  /*
    RETRACTED 2026-10-20: describe('qi naming') — QI_NAMES mapped the five
    burn states ('Atur Napas' … 'Salah Jalan') onto the hall atmosphere. The
    burn states are gone from the server, so names for them would be a
    vocabulary describing a quantity nothing measures.
  */
})
