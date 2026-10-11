/**
 * Tataran — the rail *is* the permission model, so these tests are about the
 * policy it draws, not about markup. The rail's whole claim is that altitude
 * equals permission; if a locked hall is clickable, or a cap the server
 * redacted is printed anyway, that claim is a lie.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RealmRail from './RealmRail'
import type { PolicySnapshot } from '../theme/policyClient'
import { SECT_HALLS } from '../theme/sect'

/** SECT_HALLS is indexed by string, so TS types every lookup as possibly
 *  undefined. A test may assert the hall exists; the component may not. */
function hall(id: keyof typeof SECT_HALLS) {
  const h = SECT_HALLS[id]
  if (!h) throw new Error(`no sect hall named ${String(id)}`)
  return h
}

const ladder = (over: Partial<PolicySnapshot> = {}): PolicySnapshot => ({
  viewerTier: 1,
  redacted: false,
  rungs: [
    { room: 'lobby', tier: 0, capUsd: 0.25, hall: hall('lobby') },
    { room: 'meeting-room', tier: 1, capUsd: 1, hall: hall('meeting-room') },
    { room: 'ceo-office', tier: 2, capUsd: 10, hall: hall('ceo-office') },
  ],
  ...over,
})

describe('RealmRail', () => {
  it('disables every rung above the viewer tier', () => {
    render(<RealmRail ladder={ladder()} current="lobby" occupancy={{}} onEnter={() => {}} />)
    expect(screen.getByTitle(hall('lobby').nameEn).hasAttribute('disabled')).toBe(false)
    expect(screen.getByTitle(hall('meeting-room').nameEn).hasAttribute('disabled')).toBe(false)
    // Balai Sesepuh is tier 2, viewer is tier 1.
    expect(screen.getByTitle(/Lenyap di Balik Kabut/).hasAttribute('disabled')).toBe(true)
  })

  it('does not call onEnter for a hall the viewer may not enter', () => {
    const onEnter = vi.fn()
    render(<RealmRail ladder={ladder()} current="lobby" occupancy={{}} onEnter={onEnter} />)
    fireEvent.click(screen.getByTitle(/Lenyap di Balik Kabut/))
    expect(onEnter).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle(hall('meeting-room').nameEn))
    expect(onEnter).toHaveBeenCalledWith('meeting-room')
  })

  it('hides caps when the server says they were redacted', () => {
    render(<RealmRail ladder={ladder({ redacted: true, viewerTier: 0 })}
                      current="lobby" occupancy={{}} onEnter={() => {}} />)
    // The guest cap is 0 server-side; printing "$0" would be a fabricated fact.
    expect(screen.queryByText('$0.25')).toBeNull()
    expect(screen.queryByText('$0')).toBeNull()
  })

  it('locks everything for a guest with no tier', () => {
    render(<RealmRail ladder={ladder({ viewerTier: -1, redacted: true })}
                      current="lobby" occupancy={{}} onEnter={() => {}} />)
    const locked = screen.getAllByTitle(/Lenyap di Balik Kabut/)
    expect(locked).toHaveLength(3)
    expect(locked.every((b) => b.hasAttribute('disabled'))).toBe(true)
  })

  it('marks the hall the viewer is standing in', () => {
    render(<RealmRail ladder={ladder()} current="meeting-room" occupancy={{}} onEnter={() => {}} />)
    expect(screen.getByTitle(hall('meeting-room').nameEn).getAttribute('aria-current')).toBe('true')
  })

  it('caps the presence dots instead of overflowing the rung', () => {
    const { container } = render(
      <RealmRail ladder={ladder()} current="lobby" occupancy={{ lobby: 40 }} onEnter={() => {}} />,
    )
    expect(container.querySelectorAll('.sect-rung__who i')).toHaveLength(6)
    expect(screen.getByLabelText('40 di aula ini')).toBeTruthy()
  })

  it('says so when the layout has not loaded, rather than rendering an empty rail', () => {
    render(<RealmRail ladder={null} current="lobby" occupancy={{}} onEnter={() => {}} />)
    expect(screen.getByText('Tata letak belum dimuat.')).toBeTruthy()
  })
})
