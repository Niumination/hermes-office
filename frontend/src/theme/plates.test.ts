import { describe, it, expect } from 'vitest'
import { platePath, hasThemedArt, SECT_PLATES } from './plates'

const DEFAULT = '/rooms/office-night.webp'

describe('plate resolution across themes', () => {
  it('uses sect art for a governed room', () => {
    expect(platePath('server-room', 'sect', DEFAULT)).toBe('/rooms/sect/server-room.webp')
  })

  it('falls back silently for a room with no sect art', () => {
    // parking is not governed by the policy, so it is not a hall and has no
    // art. A themed office missing four rooms is worse than an unthemed one.
    expect(platePath('parking', 'sect', DEFAULT)).toBe(DEFAULT)
    expect(hasThemedArt('parking', 'sect')).toBe(false)
  })

  it('never touches the default theme', () => {
    for (const room of [...SECT_PLATES, 'parking' as const]) {
      expect(platePath(room, 'default', DEFAULT)).toBe(DEFAULT)
    }
  })

  it('names a file for every room it claims to theme', () => {
    for (const room of SECT_PLATES) {
      expect(platePath(room, 'sect', DEFAULT)).toBe(`/rooms/sect/${room}.webp`)
    }
  })
})
