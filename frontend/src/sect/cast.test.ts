/**
 * The cast map decides which face an agent wears. Two things here are facts
 * and must be pinned; one is decoration and must be pinned only for stability.
 *
 * The test that matters most is the ghost facing. "Away" turns a character
 * around because it went quiet — it was here and stopped. A ghost has never
 * been seen at all, so drawing its back would state the one thing we know is
 * false. That distinction is a single ternary in the source and would be very
 * easy to "simplify" away.
 */
import { describe, it, expect } from 'vitest'
import { archetypeFor, spriteFor, ARCHETYPES } from './cast'

describe('archetypeFor', () => {
  it('prefers the agent id over its role, because identity beats job title', () => {
    // boss reports role "reviewer", which maps to scholar. He is the sect
    // head and must not be drawn as a junior scholar.
    expect(archetypeFor('boss', 'reviewer')).toBe('elder')
  })

  it('falls back to the role when the id is unknown', () => {
    // Only two roles exist: server/index.js gives the permanent cast
    // "generalist" and "reviewer", and labels every discovered heartbeat
    // "generalist". There is no third value to test with.
    expect(archetypeFor('some-new-worker', 'reviewer')).toBe('scholar')
    expect(archetypeFor('another-one', 'generalist')).toBe('cultivator')
  })

  it('treats the role case-insensitively, because config files are hand-written', () => {
    expect(archetypeFor('x1', 'Reviewer')).toBe('scholar')
    expect(archetypeFor('x2', 'GENERALIST')).toBe('cultivator')
  })

  it('still returns a real archetype when both id and role are unknown', () => {
    const a = archetypeFor('totally-unknown', 'no-such-role')
    expect(ARCHETYPES).toContain(a)
  })

  it('spreads unknown agents across the cast instead of cloning one archetype', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => archetypeFor(`worker-${i}`)),
    )
    // A hash that collapsed to one value would make a fleet of strangers look
    // like a rendering bug. Four of eight is a loose bound that still fails
    // hard on a constant.
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })

  it('is stable: the same agent never changes face between renders', () => {
    expect(archetypeFor('wanderer')).toBe(archetypeFor('wanderer'))
  })
})

describe('spriteFor', () => {
  it('points at a file the build script actually produces', () => {
    expect(spriteFor('cloud', 'working')).toMatch(
      /^\/sprites\/donghua\/[a-z]+-(front|rear)-(left|right)\.webp$/,
    )
  })

  it('turns a quiet agent around', () => {
    expect(spriteFor('cloud', 'away')).toContain('-rear-')
  })

  it('faces a working or idle agent toward the hall', () => {
    expect(spriteFor('cloud', 'working')).toContain('-front-')
    expect(spriteFor('cloud', 'idle')).toContain('-front-')
  })

  it('draws a ghost front-on: it never arrived, so it never turned away', () => {
    // The whole point of the ghost strip is "configured, never seen". A rear
    // view would claim a departure that never happened.
    expect(spriteFor('mac', 'ghost')).toContain('-front-')
  })

  it('keeps the same side for an agent across every state', () => {
    const side = (u: string) => (u.includes('-left.') ? 'left' : 'right')
    expect(side(spriteFor('mac', 'working'))).toBe(side(spriteFor('mac', 'idle')))
    expect(side(spriteFor('mac', 'working'))).toBe(side(spriteFor('mac', 'away')))
  })

  it('uses the archetype the role implies', () => {
    expect(spriteFor('nobody-special', 'idle', 'reviewer')).toContain('scholar-')
  })
})

describe('names this office does not have', () => {
  /**
   * Retraction, not deletion. Seven ids and seven roles were removed from
   * cast.ts because they appear nowhere in server/ or tests/ — they were
   * MIRAI's generic profile vocabulary, which the owner's own topics.json
   * warns against by name. These tests assert the claim is gone: the office
   * no longer states that it has a security auditor or a frontend developer.
   *
   * They must still RENDER — every agent gets a sprite, that rule has not
   * changed — but via the id hash, which invents nothing, rather than via a
   * table that implied the role was real.
   */
  const GONE_IDS = [
    'cron-runner', 'debugger', 'code-reviewer', 'frontend-developer',
    'fullstack-developer', 'test-engineer', 'security-auditor',
  ]
  const GONE_ROLES = [
    'fullstack', 'default', 'frontend', 'devops', 'security', 'tester', 'manager',
  ]

  it('no longer hand-picks an archetype for a MIRAI profile id', () => {
    // The sharp form of this check. An id still in the table would beat the
    // role and return its own pick; an id that has been removed must defer
    // to the role instead. Comparing the role-less call against the one with
    // a role would pass either way, which is no test at all.
    for (const id of GONE_IDS) {
      expect(archetypeFor(id, 'reviewer')).toBe('scholar')
      expect(archetypeFor(id, 'generalist')).toBe('cultivator')
    }
  })

  it('no longer hand-picks an archetype for a role the server cannot send', () => {
    for (const role of GONE_ROLES) {
      expect(archetypeFor('unknown-agent', role)).toBe(archetypeFor('unknown-agent'))
    }
  })

  it('still draws every one of them, because rendering was never the lie', () => {
    for (const id of GONE_IDS) {
      expect(spriteFor(id, 'working')).toMatch(/^\/sprites\/donghua\/[a-z]+-(front|rear)-(left|right)\.webp$/)
    }
  })
})

describe('the agents this ecosystem actually has', () => {
  it('names every Telegram topic agent rather than hashing it', () => {
    // kantor → ruang → meja → agen = mesin → kategori → repo → topik telegram.
    const named = [
      'mac/utama', 'mac/orkestrator', 'mac/research', 'mac/builder', 'mac/qa',
      'mac/kreator', 'mac/serbaguna', 'mac/cron', 'mac/edu', 'mac/asn',
      'lightvela/utama', 'lightvela/infra', 'lightvela/general',
      'lightvela/studio', 'lightvela/contentvela',
    ]
    for (const id of named) {
      // A named agent ignores the role entirely; a hashed one would not.
      expect(archetypeFor(id, 'generalist')).toBe(archetypeFor(id, 'reviewer'))
    }
  })

  it('keeps the permanent cast the server really sends', () => {
    expect(archetypeFor('cloud', 'generalist')).toBe('cultivator')
    expect(archetypeFor('mac', 'generalist')).toBe('alchemist')
    expect(archetypeFor('boss', 'reviewer')).toBe('elder')
  })
})
