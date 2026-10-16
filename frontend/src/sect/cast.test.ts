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
    expect(archetypeFor('some-new-worker', 'reviewer')).toBe('scholar')
    expect(archetypeFor('another-one', 'frontend')).toBe('weaver')
  })

  it('treats the role case-insensitively, because config files are hand-written', () => {
    expect(archetypeFor('x1', 'Reviewer')).toBe('scholar')
    expect(archetypeFor('x2', 'SECURITY')).toBe('guardian')
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
    expect(spriteFor('nobody-special', 'idle', 'security')).toContain('guardian-')
  })
})
