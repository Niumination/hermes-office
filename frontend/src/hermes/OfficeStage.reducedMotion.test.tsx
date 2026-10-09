import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { stubMatchMedia } from '../test/setup'
import OfficeStage from './OfficeStage'
import { resetThemeForTests } from '../theme/themeStore'

/**
 * Regression guard for a hang.
 *
 * OfficeStage has an effect that depends on `agents` and also writes
 * `agents`. Under prefers-reduced-motion it rebuilt the whole array every
 * pass, so React saw a new value, re-ran the effect, and never stopped —
 * the tab locked up and the test worker died with SIGABRT on OOM. It could
 * not converge even in principle, because one of the fields it wrote was a
 * random status message.
 *
 * The failure mode is a hang, so the assertion is simply that this test
 * finishes: a regression here does not produce a red expectation, it
 * produces a dead worker. The expectations below are there to prove the
 * behaviour the effect is supposed to deliver is still delivered.
 */

beforeEach(() => {
  stubMatchMedia(true)
  resetThemeForTests()
})

function Harness() {
  const spawned = useRef(new Set<string>())
  return (
    <OfficeStage
      phase="day"
      nightOpacity={0}
      drainPending={() => []}
      pendingTick={0}
      spawnedRef={spawned}
    />
  )
}

describe('OfficeStage under prefers-reduced-motion', () => {
  it('settles instead of looping forever', () => {
    render(<Harness />)
    expect(screen.getByTestId('office-stage')).toBeInTheDocument()
  })

  it('still applies the reduced-motion treatment it exists for', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('.room-container')).toHaveClass('reduced-motion')
  })
})
