/**
 * The hall is where the UI is most tempted to lie. Two temptations in
 * particular are tested here:
 *
 *   - Claiming a refusal the server never made.
 *   - Reporting an unread floor as an empty one.
 *
 * RETRACTED: the two veil tests. The veil could only be raised by
 * `locked`, which compared a rung's budget-band rank against the HIGHEST
 * rank present — false by construction, so the curtain was unreachable and
 * its wording promised a per-hall 403 this one-owner office cannot issue.
 * The guarantees are inverted below rather than dropped: no alert may
 * appear, and no cultivator may be withheld, for ANY hall.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Hall from './Hall'
import type { SectHall } from '../theme/sect'

/**
 * Hall takes a name triple and renders it; it has never cared where the names
 * came from. These used to be pulled out of SECT_HALLS, so the fixtures were
 * the fork's eight rooms and every test read as though a "ceo-office" existed.
 * A local fixture keeps the component's contract under test without tying it
 * to a vocabulary the office no longer speaks.
 */
function hall(id: string): SectHall {
  return { nameId: `Balai ${id}`, nameEn: id, band: 'Uji' }
}

const cul = (over = {}) => ({
  id: 'a1', name: 'Niu', glyph: 'NU', state: 'working' as const, ...over,
})

describe('Hall', () => {
  it('shows the hall name in Chinese and the gloss beside it, never instead of it', () => {
    render(<Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp" occupancyKnown cultivators={[]} />)
    expect(screen.getByText(hall('ceo-office').nameId)).toBeTruthy()
    expect(screen.getByText(hall('ceo-office').nameEn)).toBeTruthy()
  })

  it('never veils a hall, and never withholds who is standing in it', () => {
    // Inverse of the two retracted veil tests. There is one owner: a hall the
    // office can draw at all is a hall they may see, so an occupant that
    // reached this component must reach the screen.
    render(<Hall room="mac/dinas" hall={hall('mac/dinas')} plate="/p.webp"
                 occupancyKnown cultivators={[cul(), cul({ id: 'a2', name: 'Rahasia' })]} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Niu')).toBeTruthy()
    expect(screen.getByText('Rahasia')).toBeTruthy()
  })

  it('carries no viewer-class notice: there is only one class of viewer', () => {
    // The hall used to stamp "Tamu — angka diredaksi" over the plate so a
    // guest knew the blank budgets were the server's doing and not the UI's.
    // With the guest role gone that notice could only ever be false.
    render(<Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown cultivators={[]} />)
    expect(screen.queryByText(/Tamu/)).toBeNull()
    expect(screen.queryByText(/diredaksi/)).toBeNull()
  })

  it('says a hall is empty rather than rendering a blank floor', () => {
    render(<Hall room="kitchen" hall={hall('kitchen')} plate="/p.webp" occupancyKnown cultivators={[]} />)
    expect(screen.getByText(/Balai kosong/)).toBeTruthy()
  })

  it('falls back to the room id when a hall has no sect name yet', () => {
    render(<Hall room="lobby" hall={undefined} plate="/p.webp" occupancyKnown cultivators={[]} />)
    expect(screen.getByText('lobby')).toBeTruthy()
  })

  it('draws the character art when a sprite is given', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    const img = container.querySelector('img.sect-cul__art') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/sprites/donghua/elder-front-left.webp')
  })

  it('marks a drawn disciple so the CSS can give the sprite a floor, not a halo', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    expect(container.querySelector('.sect-cul--art')).toBeTruthy()
  })

  it('still uses the mark when no sprite is given, exactly as before', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul()]} />,
    )
    expect(container.querySelector('img.sect-cul__art')).toBeNull()
    expect(screen.getByText('NU')).toBeTruthy()
  })

  it('falls back to the mark when the image fails, so a half-deploy is not an empty office', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul({ sprite: '/assets/missing-cultivator.webp' })]} />,
    )
    const img = container.querySelector('img.sect-cul__art') as HTMLImageElement
    fireEvent.error(img)
    expect(container.querySelector('img.sect-cul__art')).toBeNull()
    expect(screen.getByText('NU')).toBeTruthy()
  })

  it('hides the art from the accessibility tree — the name beside it is the content', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul({ sprite: '/sprites/donghua/elder-front-left.webp' })]} />,
    )
    expect(container.querySelector('img.sect-cul__art')?.getAttribute('alt')).toBe('')
  })
})

describe('Hall — ghosts', () => {
  const ghost = (id: string) => ({
    id, name: id, glyph: 'XX', state: 'ghost' as const,
    sprite: `/sprites/donghua/cultivator-front-left.webp`,
  })

  it('shows a rostered agent that was never placed, instead of pretending it does not exist', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[]} ghosts={[ghost('mac'), ghost('boss')]} />,
    )
    expect(screen.getByText('mac')).toBeTruthy()
    expect(screen.getByText('boss')).toBeTruthy()
  })

  it('keeps ghosts OUT of the court, which is the server floor plan', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[cul()]} ghosts={[ghost('mac')]} />,
    )
    const court = container.querySelector('.sect-court:not(.sect-court--ghosts)')!
    expect(court.textContent).toContain('Niu')
    expect(court.textContent).not.toContain('mac')
  })

  it('says in words that a ghost has never been seen, so it is not read as presence', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(screen.getByText(/belum pernah terlihat/i)).toBeTruthy()
  })

  it('still reports an empty court when only ghosts exist — nobody is actually here', () => {
    render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
        cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(screen.getByText('Balai kosong')).toBeTruthy()
  })

  it('draws the ghost strip for any hall, since none is veiled', () => {
    // Was 'draws no ghost strip behind the veil'. With the veil retracted the
    // rule inverts with it: a roster entry the office knows about is shown,
    // and the strip itself is what keeps it from being mistaken for presence.
    const { container } = render(
      <Hall room="mac/dinas" hall={hall('mac/dinas')} plate="/p.webp"
        occupancyKnown cultivators={[]} ghosts={[ghost('mac')]} />,
    )
    expect(container.querySelector('.sect-court--ghosts')).toBeTruthy()
    expect(screen.getByText('mac')).toBeTruthy()
  })

  it('renders nothing extra when there are no ghosts', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" occupancyKnown
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
    render(<Hall room="root" hall={hall('ceo-office')} plate="/p.webp" occupancyKnown={false} cultivators={[]} />)
    expect(screen.queryByText('Balai kosong')).toBeNull()
    expect(screen.getByText(/Tidak diketahui/)).toBeTruthy()
    expect(screen.getByText(/Belum masuk/)).toBeTruthy()
  })

  it('still says empty when it genuinely knows the court is empty', () => {
    render(<Hall room="root" hall={hall('ceo-office')} plate="/p.webp" occupancyKnown cultivators={[]} />)
    expect(screen.getByText('Balai kosong')).toBeTruthy()
    expect(screen.queryByText(/Tidak diketahui/)).toBeNull()
  })
})
