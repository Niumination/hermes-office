import { describe, it, expect } from 'vitest'
import {
  OFFICES, OFFICE_ORDER, ROOMS, DESKS, AGENTS,
  roomsOf, desksOf, agentsOf, deskAt, agentAt, roomAt,
  pinnedAgents, mayWorkAt, placeAgent, describePlacement,
  roomRef, roomByRef, officeOfRef,
} from './ecosystem'

/**
 * The specification is one sentence. These tests are that sentence, pinned
 * down from both ends: the two placements the owner gave by name must come out
 * right, and the ways the old office lied must stay impossible.
 */
describe('the sentence the office must be able to say', () => {
  it('places the Mac primary agent at mirai, in the root room', () => {
    const p = placeAgent('mac/utama', 'mirai')
    expect(p).not.toBeNull()
    expect(describePlacement(p!)).toBe(
      'Agen Utama di Mac · ruang Root Ekosistem · meja mirai',
    )
  })

  it('places the LightVela primary agent at hermes-office, in the root room', () => {
    const p = placeAgent('lightvela/utama', 'hermes-office')
    expect(p).not.toBeNull()
    expect(describePlacement(p!)).toBe(
      'Agen Utama di LightVela · ruang Root Ekosistem · meja hermes-office',
    )
  })

  it('places a named topic agent, not just the primary one', () => {
    const p = placeAgent('mac/orkestrator', 'mirai')
    expect(describePlacement(p!)).toBe(
      'Orkestrator di Mac · ruang Root Ekosistem · meja mirai',
    )
  })
})

describe('two offices, each with its own rooms', () => {
  it('has exactly two offices and keeps their order stable', () => {
    expect(OFFICE_ORDER).toEqual(['mac', 'lightvela'])
    expect(Object.keys(OFFICES).sort()).toEqual(['lightvela', 'mac'])
  })

  it('gives each office its own root room', () => {
    for (const id of OFFICE_ORDER) {
      const roots = roomsOf(id).filter((r) => r.isRoot)
      expect(roots).toHaveLength(1)
      expect(roots[0].id).toBe('root')
    }
  })

  it('does not mirror the Mac folder taxonomy onto LightVela', () => {
    const cloud = roomsOf('lightvela').map((r) => r.id)
    for (const macOnly of ['apps', 'services', 'sites', 'desktop', 'labs', 'dinas', 'brain', 'skills', 'vault']) {
      expect(cloud).not.toContain(macOnly)
    }
  })

  it('keeps LightVela smaller than the Mac, because it is', () => {
    expect(roomsOf('lightvela').length).toBeLessThan(roomsOf('mac').length)
  })
})

describe('rooms the fork left behind are gone', () => {
  const inherited = ['lobby', 'meeting-room', 'main-office', 'ceo-office', 'kitchen', 'nap-room', 'mac-studio', 'server-room']

  it('draws no room the ecosystem does not have', () => {
    const ids = ROOMS.map((r) => r.id)
    for (const ghost of inherited) expect(ids).not.toContain(ghost)
  })

  it('in particular has no kitchen and no nap room', () => {
    const labels = ROOMS.map((r) => r.label.toLowerCase()).join(' ')
    expect(labels).not.toContain('santap')
    expect(labels).not.toContain('hening')
  })
})

describe('an agent is a Telegram topic, not an invented archetype', () => {
  it('scopes identity by office so the two Generals never collide', () => {
    const ids = AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('lightvela/general')
    // Mac's unthreaded inbox is the primary agent, not a topic called General.
    expect(ids).not.toContain('mac/general')
  })

  it('models the primary agent as an absent topic id, per topics.json', () => {
    for (const id of OFFICE_ORDER) {
      const primaries = agentsOf(id).filter((a) => a.primary)
      expect(primaries).toHaveLength(1)
      expect(primaries[0].topicId).toBeNull()
    }
  })

  it('carries the real Mac topic ids', () => {
    expect(agentAt('mac/orkestrator')?.topicId).toBe(13902)
    expect(agentAt('mac/research')?.topicId).toBe(802)
    expect(agentAt('mac/asn')?.topicId).toBe(8853)
  })

  it('carries the real LightVela topic ids', () => {
    expect(agentAt('lightvela/infra')?.topicId).toBe(55)
    expect(agentAt('lightvela/general')?.topicId).toBe(1)
    expect(agentAt('lightvela/studio')?.topicId).toBe(838)
    expect(agentAt('lightvela/contentvela')?.topicId).toBe(5)
  })

  it('agrees with the cron records: infra is topic 55', () => {
    // lightvela-cloud-ekosistem.md §5 — all five cron jobs deliver to #55,
    // which is infrastructure traffic. Two independent sources, one number.
    expect(agentAt('lightvela/infra')?.topicId).toBe(55)
  })

  it('keeps every topic id unique inside its own office', () => {
    for (const id of OFFICE_ORDER) {
      const ids = agentsOf(id).map((a) => a.topicId).filter((t): t is number => t !== null)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('lets topic 1 mean different things in the two offices, on purpose', () => {
    // Mac: an unthreaded message is the inbox, so topic 1 is not mapped.
    // LightVela: General runs as its own topic beside a separate primary.
    expect(agentsOf('mac').map((a) => a.topicId)).not.toContain(1)
    expect(agentAt('lightvela/general')?.topicId).toBe(1)
    expect(agentAt('lightvela/general')?.primary).toBe(false)
  })

  it('uses none of the archetype words cast.ts guessed', () => {
    const labels = AGENTS.map((a) => a.label.toLowerCase()).join(' ')
    for (const guess of ['cultivator', 'weaver', 'forge', 'guardian', 'scholar', 'alchemist', 'physician', 'elder']) {
      expect(labels).not.toContain(guess)
    }
  })
})

describe('pinned agents cannot be drawn anywhere else', () => {
  it('pins exactly the two the owner named', () => {
    expect(pinnedAgents().map((a) => a.id).sort()).toEqual(['lightvela/contentvela', 'mac/asn'])
  })

  it('lets ASN work asn-admin', () => {
    expect(placeAgent('mac/asn', 'asn-admin')).not.toBeNull()
  })

  it('refuses to draw ASN at any other desk', () => {
    expect(placeAgent('mac/asn', 'mirai')).toBeNull()
    expect(placeAgent('mac/asn', 'sapa-ai')).toBeNull()
  })

  it('refuses to draw Contentvela away from contentvela', () => {
    expect(placeAgent('lightvela/contentvela', 'contentvela')).not.toBeNull()
    expect(placeAgent('lightvela/contentvela', 'hermes-office')).toBeNull()
  })

  it('lets roaming agents move between desks', () => {
    expect(mayWorkAt(agentAt('mac/builder')!, 'mirai')).toBe(true)
    expect(mayWorkAt(agentAt('mac/builder')!, 'sapa-ai')).toBe(true)
  })
})

describe('an agent never crosses between offices', () => {
  it('will not seat a Mac agent at a LightVela desk', () => {
    expect(placeAgent('mac/utama', 'hermes-office')).toBeNull()
    expect(placeAgent('mac/builder', 'contentvela')).toBeNull()
  })

  it('will not seat a LightVela agent at a Mac desk', () => {
    expect(placeAgent('lightvela/utama', 'mirai')).toBeNull()
  })
})

describe('unknown is answered as unknown, never as zero', () => {
  it('returns null for an agent that does not exist', () => {
    expect(placeAgent('mac/nobody', 'mirai')).toBeNull()
  })

  it('returns null for a desk that does not exist', () => {
    expect(placeAgent('mac/utama', 'no-such-repo')).toBeNull()
  })

  it('returns null rather than inventing a room for an orphan desk', () => {
    // Every desk must resolve to a room that exists in the same office.
    for (const d of DESKS) expect(roomAt(d.office, d.room)).toBeDefined()
  })
})

describe('desks are repositories', () => {
  it('puts mirai in the Mac root and hermes-office in the LightVela root', () => {
    expect(deskAt('mac', 'mirai')?.room).toBe('root')
    expect(deskAt('lightvela', 'hermes-office')?.room).toBe('root')
  })

  it('keeps desk ids unique within an office', () => {
    for (const id of OFFICE_ORDER) {
      const ids = desksOf(id).map((d) => d.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('marks the private repos as private', () => {
    expect(deskAt('mac', 'asn-admin')?.private).toBe(true)
    expect(deskAt('mac', 'niumination-restore')?.private).toBe(true)
  })

  it('gives every private desk a room and a label anyway', () => {
    // Existence is a fact even when contents are not readable.
    for (const d of DESKS.filter((x) => x.private)) {
      expect(d.label.length).toBeGreaterThan(0)
      expect(roomAt(d.office, d.room)).toBeDefined()
    }
  })

  it('never claims a repo it has not transcribed from the catalog', () => {
    for (const d of DESKS) {
      if (d.repo !== null) expect(d.repo).toMatch(/^Niumination\/[\w.\-]+$/)
    }
  })
})

describe('room references', () => {
  it('round-trips every declared room', () => {
    for (const r of ROOMS) {
      expect(roomByRef(roomRef(r.office, r.id))).toBe(r)
      expect(officeOfRef(roomRef(r.office, r.id))).toBe(r.office)
    }
  })

  it('refuses a bare id, because `root` exists in both offices', () => {
    // This is the whole reason references are namespaced. Resolving `root`
    // would have to pick an office, and picking one invents a location.
    expect(ROOMS.filter((r) => r.id === 'root')).toHaveLength(2)
    expect(roomByRef('root')).toBeUndefined()
    expect(officeOfRef('root')).toBeUndefined()
  })

  it('refuses a reference to an office that does not exist', () => {
    expect(roomByRef('aws/root')).toBeUndefined()
    expect(roomByRef('mac/kolam-renang')).toBeUndefined()
  })

  it('does not resolve the policy default, which names no place', () => {
    // The server governs `belum-dipetakan` on purpose. It is not a room, and
    // resolving it to one would be the fabrication this model exists to stop.
    expect(roomByRef('belum-dipetakan')).toBeUndefined()
  })
})
