import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { stubMatchMedia } from '../test/setup'
import OfficeStage from './OfficeStage'
import { setTheme, resetThemeForTests } from '../theme/themeStore'

/**
 * The wiring test. Everything else about the sect theme can be green while
 * the office still draws the old art, because the theme only becomes real
 * at this one line in OfficeStage. So this renders the actual stage and
 * reads the actual background URL.
 *
 * `main-office` is the default room and has a sect hall, which makes it the
 * case that must change. The fallback case is covered in plates.test.ts.
 */

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

const bg = (c: HTMLElement) =>
  (c.querySelector('.room-background') as HTMLElement).style.backgroundImage

beforeEach(() => {
  stubMatchMedia(true) // the branch that used to hang
  resetThemeForTests()
})
afterEach(() => resetThemeForTests())

describe('OfficeStage honours the theme', () => {
  it('draws the default plate when the theme is off', () => {
    const { container } = render(<Harness />)
    expect(bg(container)).toContain('/rooms/office-day.webp')
    expect(bg(container)).not.toContain('/sect/')
  })

  it('draws the sect hall when the theme is on', () => {
    setTheme('sect')
    const { container } = render(<Harness />)
    expect(bg(container)).toContain('/rooms/sect/main-office.webp')
  })
})
