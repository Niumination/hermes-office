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
import { render, screen } from '@testing-library/react'
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
                 locked={false} cultivators={[]} />)
    expect(screen.getByText(hall('ceo-office').nameId)).toBeTruthy()
    expect(screen.getByText(hall('ceo-office').nameEn)).toBeTruthy()
  })

  it('renders no cultivator at all behind the veil', () => {
    render(<Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp"
                 locked cultivators={[cul(), cul({ id: 'a2', name: 'Rahasia' })]} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Niu')).toBeNull()
    expect(screen.queryByText('Rahasia')).toBeNull()
  })

  it('does not veil a hall the viewer may enter', () => {
    render(<Hall room="lobby" hall={hall('lobby')} plate="/p.webp"
                 locked={false} cultivators={[cul()]} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Niu')).toBeTruthy()
  })

  it('tells a guest their figures were redacted by the server, not hidden by the UI', () => {
    render(<Hall room="lobby" hall={hall('lobby')} plate="/p.webp"
                 locked={false} guest cultivators={[]} />)
    expect(screen.getByText(/Tamu — angka/)).toBeTruthy()
  })

  it('does not show the guest notice inside the veil, where it would be noise', () => {
    render(<Hall room="ceo-office" hall={hall('ceo-office')} plate="/p.webp"
                 locked guest cultivators={[]} />)
    expect(screen.queryByText(/Tamu — angka/)).toBeNull()
  })

  it('says a hall is empty rather than rendering a blank floor', () => {
    render(<Hall room="kitchen" hall={hall('kitchen')} plate="/p.webp"
                 locked={false} cultivators={[]} />)
    expect(screen.getByText(/Balai kosong/)).toBeTruthy()
  })

  it('falls back to the room id when a hall has no sect name yet', () => {
    render(<Hall room="lobby" hall={undefined} plate="/p.webp" locked={false} cultivators={[]} />)
    expect(screen.getByText('lobby')).toBeTruthy()
  })

  it('carries the qi state onto the cultivator so burn is visible as aura', () => {
    const { container } = render(
      <Hall room="lobby" hall={hall('lobby')} plate="/p.webp" locked={false}
            cultivators={[cul({ qi: 'critical', state: 'away' })]} />,
    )
    const fig = container.querySelector('.sect-cul')!
    expect(fig.className).toContain('sect-cul--away')
    expect(fig.getAttribute('style')).toContain('--sect-qi-3')
  })
})
