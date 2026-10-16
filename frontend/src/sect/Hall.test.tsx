/**
 * The hall is where the UI is most tempted to lie. Two temptations in
 * particular are tested here:
 *
 *   - Veiling a hall the viewer is actually allowed to see, which invents a
 *     refusal the server never made.
 *   - Rendering cultivators behind the veil anyway, which leaks the very thing
 *     the veil claims to be hiding.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Hall from './Hall'
import { SECT_HALLS } from '../theme/sect'

/** SECT_HALLS is indexed by string, so TS types every lookup as possibly
 *  undefined. A test may assert the hall exists; the component may not. */
function hall(id: keyof typeof SECT_HALLS) {
  const h = SECT_HALLS[id]
  if (!h) throw new Error(`no sect hall named ${String(id)}`)
  return h
}

const cul = (over = {}) => ({
  id: 'a1', name: 'Niu', glyph: 'NU', state: 'working' as const, qi: 'normal' as const, ...over,
})

describe('Hall', () => {
  it('shows the hall name in Chinese and the gloss beside it, never instead of it', () => {
    render(<Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp"
                 locked={false} occupancyKnown cultivators={[]} />)
    expect(screen.getByText(hall('ceo-office').nameId)).toBeTruthy()
    expect(screen.getByText(hall('ceo-office').nameEn)).toBeTruthy()
  })

  it('renders no cultivator at all behind the veil', () => {
    render(<Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp"
                 locked occupancyKnown cultivators={[cul(), cul({ id: 'a2', name: 'Rahasia' })]} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Niu')).toBeNull()
    expect(screen.queryByText('Rahasia')).toBeNull()
  })

  it('does not veil a hall the viewer may enter', () => {
    render(<Hall room="lobby" hall={hall('lobby')} plate="/p.webp"
                 locked={false} occupancyKnown cultivators={[cul()]} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Niu')).toBeTruthy()
  })

  it('carries no viewer-class notice: there is only one class of viewer', () => {
    // The hall used to stamp "Tamu — angka diredaksi" over the plate so a
    // guest knew the blank budgets were the server's doing and not the UI's.
    // With the guest role gone that notice could only ever be false.
    render(<Hall room="lobby" hall={hall('lobby')} plate="/p.webp"
                 locked={false} occupancyKnown cultivators={[]} />)
    expect(screen.queryByText(/Tamu/)).toBeNull()
    expect(screen.queryByText(/diredaksi/)).toBeNull()
  })

  it('says a hall is empty rather than rendering a blank floor', () => {
    render(<Hall room="kitchen" hall={hall('kitchen')} plate="/p.webp"
                 locked={false} occupancyKnown cultivators={[]} />)
    expect(screen.getByText(/Balai kosong/)).toBeTruthy()
  })

  it('falls back to the room id when a hall has no sect name yet', () => {
    render(<Hall room="lobby" hall={undefined} plate="/p.webp" locked={false} occupancyKnown cultivators={[]} />)
    expect(screen.getByText('lobby')).toBeTruthy()
  })

  it('carries the qi state onto the cultivator so burn is visible as aura', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
            cultivators={[cul({ qi: 'critical', state: 'away' })]} />,
    )
    const fig = container.querySelector('.sect-cul')!
    expect(fig.className).toContain('sect-cul--away')
    expect(fig.getAttribute('style')).toContain('--sect-qi-3')
  })
})

/**
 * The cast came back on 2026-10-15. These tests exist because it left
 * silently once already: the Sect migration dropped the sprite reader, every
 * gate stayed green, and the characters were gone for three days before
 * anyone said so out loud. Each test below is one way that could happen again.
 */
describe('Hall — the cast', () => {
  it('draws the character art when a sprite is given', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    const img = container.querySelector('img.sect-cul__art') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/sprites/donghua/elder-front-left.webp')
  })

  it('marks a drawn disciple so the CSS can give the qi ring a floor, not a halo', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    expect(container.querySelector('.sect-cul--art')).toBeTruthy()
  })

  it('still uses the mark when no sprite is given, exactly as before', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul()]} />,
    )
    expect(container.querySelector('img.sect-cul__art')).toBeNull()
    expect(screen.getByText('NU')).toBeTruthy()
  })

  it('falls back to the mark when the image fails, so a half-deploy is not an empty office', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/missing.webp' })]} />,
    )
    const img = container.querySelector('img.sect-cul__art') as HTMLImageElement
    fireEvent.error(img)
    expect(container.querySelector('img.sect-cul__art')).toBeNull()
    expect(screen.getByText('NU')).toBeTruthy()
  })

  it('hides the art from the accessibility tree — the name beside it is the content', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    expect(container.querySelector('img.sect-cul__art')?.getAttribute('alt')).toBe('')
  })
})

describe('Hall — ghosts', () => {
  const ghost = (id: string) => ({
    id, name: id, glyph: 'XX', state: 'ghost' as const, qi: 'normal' as const,
    sprite: `/sprites/donghua/cultivator-front-left.webp`,
  })

  it('shows a rostered agent that was never placed, instead of pretending it does not exist', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[]} ghosts={[ghost('mac'), ghost('boss')]} />,
    )
    expect(screen.getByText('mac')).toBeTruthy()
    expect(screen.getByText('boss')).toBeTruthy()
  })

  it('keeps ghosts OUT of the court, which is the server floor plan', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul()]} ghosts={[ghost('mac')]} />,
    )
    const court = container.querySelector('.sect-court:not(.sect-court--ghosts)')!
    expect(court.textContent).toContain('Niu')
    expect(court.textContent).not.toContain('mac')
  })

  it('says in words that a ghost has never been seen, so it is not read as presence', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(screen.getByText(/belum pernah terlihat/i)).toBeTruthy()
  })

  it('still reports an empty court when only ghosts exist — nobody is actually here', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(screen.getByText('Balai kosong')).toBeTruthy()
  })

  it('draws no ghost strip behind the veil, same rule as cultivators', () => {
    const { container } = render(
      <Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp" locked={true}
        occupancyKnown cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(container.querySelector('.sect-court--ghosts')).toBeNull()
    expect(screen.queryByText('mac')).toBeNull()
  })

  it('renders nothing extra when there are no ghosts', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false} occupancyKnown
        cultivators={[cul()]} />,
    )
    expect(container.querySelector('.sect-court--ghosts')).toBeNull()
  })

  /**
   * The defect this pair of tests pins down: signed out, every occupancy
   * source answers 401, `cultivators` arrives empty, and the court used to
   * draw "Balai kosong" — a report on a floor plan it had never been allowed
   * to read. Refused and empty are different answers and must not share a
   * single rendering.
   */
  it('does not call an unread court an empty one', () => {
    render(<Hall room="root" hall={hall('ceo-office')} plate="/p.webp"
                 locked={false} occupancyKnown={false} cultivators={[]} />)
    expect(screen.queryByText('Balai kosong')).toBeNull()
    expect(screen.getByText(/Tidak diketahui/)).toBeTruthy()
    expect(screen.getByText(/Belum masuk/)).toBeTruthy()
  })

  it('still says empty when it genuinely knows the court is empty', () => {
    render(<Hall room="root" hall={hall('ceo-office')} plate="/p.webp"
                 locked={false} occupancyKnown cultivators={[]} />)
    expect(screen.getByText('Balai kosong')).toBeTruthy()
    expect(screen.queryByText(/Tidak diketahui/)).toBeNull()
  })
})
