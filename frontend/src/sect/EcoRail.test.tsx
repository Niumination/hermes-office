/**
 * EcoRail had no tests at all when it replaced RealmRail, which did. Deleting
 * the old file would have quietly dropped seven guarantees, so the ones that
 * still mean something were carried here and rewritten against the new model.
 *
 * Two of the old rules died with the thing they described, and are recorded
 * rather than silently dropped:
 *
 *   - "prints a dot, not $0, for a hall the policy budgets at zero" — the rail
 *     no longer shows hourly budget at all, so there is no $0 to misprint.
 *   - "says so when the layout has not loaded, rather than rendering an empty
 *     rail" — the layout cannot fail to load any more. Rooms come from the
 *     ecosystem model, not from a fetch, so the empty-rail state it guarded
 *     against is now unreachable. `renders without any server at all` below is
 *     the inverted form of that check.
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import EcoRail from './EcoRail'
import { roomsOf, desksOf } from '../eco/ecosystem'

afterEach(cleanup)

const noop = () => {}

describe('EcoRail', () => {
  it('renders without any server at all', () => {
    // The old rail needed a fetched layout and had a state for not having it.
    // This one reads the model, so every room is there on first paint.
    render(<EcoRail office="mac" room="root" onOffice={noop} onEnter={noop} />)
    for (const r of roomsOf('mac')) {
      expect(screen.getByText(r.label)).toBeTruthy()
    }
  })

  it('shows one office at a time, never both', () => {
    render(<EcoRail office="mac" room="root" onOffice={noop} onEnter={noop} />)
    // 'Content Studio' belongs to LightVela only.
    expect(screen.queryByText('Content Studio')).toBeNull()
    expect(screen.getByText('Apps')).toBeTruthy()
  })

  it('does not graft the Mac taxonomy onto LightVela', () => {
    // The owner was explicit: LightVela has no folder taxonomy, and the Mac's
    // sixteen roots must not be transplanted there.
    render(<EcoRail office="lightvela" room="root" onOffice={noop} onEnter={noop} />)
    for (const id of ['Apps', 'Services', 'Dinas', 'Brain', 'Skills', 'Vault']) {
      expect(screen.queryByText(id)).toBeNull()
    }
    expect(roomsOf('lightvela')).toHaveLength(3)
  })

  it('counts desks, which is a fact, and says so in the legend', () => {
    render(<EcoRail office="lightvela" room="root" onOffice={noop} onEnter={noop} />)
    const infra = desksOf('lightvela', 'infra')
    expect(screen.getByTitle(`${infra.length} meja`)).toBeTruthy()
    expect(screen.getByText(/bukan jumlah penghuni/)).toBeTruthy()
  })

  /**
   * The rule the whole floor plan was rebuilt around. An office with no
   * session knows nothing about occupancy, and `undefined` must not be
   * flattened into `0` — that flattening is what printed `MURID 0` over an
   * office answering 401 eleven times.
   */
  it('draws no occupancy at all when occupancy is unknown', () => {
    const { container } = render(
      <EcoRail office="mac" room="root" onOffice={noop} onEnter={noop} />,
    )
    expect(container.querySelectorAll('.eco-rail-floor__here')).toHaveLength(0)
  })

  it('draws occupancy only where someone actually is', () => {
    const { container } = render(
      <EcoRail office="mac" room="root" onOffice={noop} onEnter={noop}
               occupancy={{ apps: 2, services: 0 }} />,
    )
    const badges = [...container.querySelectorAll('.eco-rail-floor__here')]
    // `services: 0` is a known zero and still draws nothing: a badge reading
    // "0" is noise, while its absence is already the same statement.
    expect(badges.map((b) => b.textContent)).toEqual(['2'])
  })

  it('marks the room the viewer is standing in', () => {
    render(<EcoRail office="mac" room="labs" onOffice={noop} onEnter={noop} />)
    const here = screen.getByText('Labs').closest('button')!
    expect(here.getAttribute('aria-current')).toBe('true')
    const other = screen.getByText('Apps').closest('button')!
    expect(other.getAttribute('aria-current')).toBeNull()
  })

  it('reports the room id, not the label, when one is entered', () => {
    const onEnter = vi.fn()
    render(<EcoRail office="mac" room="root" onOffice={noop} onEnter={onEnter} />)
    fireEvent.click(screen.getByText('Skills'))
    expect(onEnter).toHaveBeenCalledWith('skills')
  })

  it('offers the other office as a tab and reports its id', () => {
    const onOffice = vi.fn()
    render(<EcoRail office="mac" room="root" onOffice={onOffice} onEnter={noop} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs.find((t) => t.getAttribute('aria-selected') === 'true')!.textContent)
      .toContain('Mac')
    fireEvent.click(screen.getByText('LightVela'))
    expect(onOffice).toHaveBeenCalledWith('lightvela')
  })

  it('names the filesystem root it is describing', () => {
    render(<EcoRail office="mac" room="root" onOffice={noop} onEnter={noop} />)
    expect(screen.getByText('~/Desktop/Niumination')).toBeTruthy()
    cleanup()
    render(<EcoRail office="lightvela" room="root" onOffice={noop} onEnter={noop} />)
    expect(screen.getByText('~/niumination')).toBeTruthy()
  })
})
