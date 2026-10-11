/**
 * The qi ring has to tell three situations apart, and the first version of it
 * did not. It folded "the server redacted this" and "no hourly limit is
 * configured" into one blank `— — —`, which hid a figure the viewer was
 * entitled to see behind a privacy state they were not in.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import QiRing from './QiRing'
import type { BurnSnapshot, BurnState } from '../hermes/burnTypes'
import { BURN_STATES } from '../hermes/burnTypes'
import { QI_NAMES } from '../theme/sect'

function snap(global: Partial<BurnSnapshot['global']>): BurnSnapshot {
  return {
    global: {
      spentHourUsd: 0, spentDayUsd: 0,
      limitHourUsd: null, limitDayUsd: null,
      ratio: null, state: 'normal', lifetimeUsd: 0,
      ...global,
    },
    agents: [],
  }
}

describe('QiRing', () => {
  it('shows the spend and the limit when both are known', () => {
    render(<QiRing state="warm" snapshot={snap({ spentHourUsd: 2.5, limitHourUsd: 10, ratio: 0.25 })} />)
    expect(screen.getByText('$2.50 / $10.00')).toBeTruthy()
  })

  it('still shows the spend when no limit is configured', () => {
    // The regression this guards: ratio === null does not mean "unknown
    // spend". $1.25 was measured and the viewer may see it.
    render(<QiRing state="normal" snapshot={snap({ spentHourUsd: 1.25, ratio: null, limitHourUsd: null })} />)
    expect(screen.getByText('$1.25 · tanpa pagu')).toBeTruthy()
  })

  it('shows nothing but the redaction notice for a guest', () => {
    render(<QiRing state="normal" snapshot={snap({ spentHourUsd: 0, redacted: true })} />)
    expect(screen.getByText('Tamu · diredaksi')).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('never reports a proportion it was not given', () => {
    const { container } = render(
      <QiRing state="normal" snapshot={snap({ spentHourUsd: 9, ratio: null })} />,
    )
    const arc = container.querySelectorAll('circle')[1]
    // A full or proportional arc here would be an invented number.
    expect(arc.getAttribute('stroke-dasharray')).toBe('2 6')
  })

  it('renders a qi name for every burn state the server can send', () => {
    // Totality: a sixth state added server-side must not render blank.
    for (const s of BURN_STATES) {
      const { unmount } = render(<QiRing state={s as BurnState} snapshot={snap({})} />)
      expect(screen.getByText(QI_NAMES[s].nameId)).toBeTruthy()
      unmount()
    }
  })

  it('survives a snapshot that never arrived', () => {
    render(<QiRing state="normal" snapshot={null} />)
    expect(screen.getByText(QI_NAMES.normal.nameId)).toBeTruthy()
  })
})
