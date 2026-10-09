import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SectLadder from './SectLadder'
import { sectLadder, type PolicyRoomLike } from '../theme/sect'

/**
 * The contract being pinned here is a governance one, not a visual one:
 * a hall the viewer may not enter must not be clickable, and must not be
 * presented as if it merely needs a nudge. The server will 403; the picture
 * has to agree with the server.
 */

const POLICY: Record<string, PolicyRoomLike> = {
  lobby: { budgetHourlyUsd: 0.25 },
  'main-office': { budgetHourlyUsd: 2 },
  'server-room': { budgetHourlyUsd: 5 },
  'ceo-office': { budgetHourlyUsd: 10 },
}
const RUNGS = sectLadder(POLICY)
const tierOf = (room: string) => RUNGS.find((r) => r.room === room)!.tier

describe('SectLadder', () => {
  it('draws the summit first, so the mountain reads top-down', () => {
    render(<SectLadder rungs={RUNGS} viewerTier={9} />)
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(names[0]).toContain('掌門殿')
    expect(names[names.length - 1]).toContain('山門')
  })

  it('shows the policy cap, never a number of its own', () => {
    render(<SectLadder rungs={RUNGS} viewerTier={9} />)
    expect(screen.getByText('$10.00')).toBeInTheDocument()
    expect(screen.getByText('$0.25')).toBeInTheDocument()
  })

  it('locks halls above the viewer tier and refuses the click', async () => {
    const onSelect = vi.fn()
    render(
      <SectLadder rungs={RUNGS} viewerTier={tierOf('lobby')} onSelect={onSelect} />,
    )
    const ceo = screen.getByRole('button', { name: /掌門殿/ })
    expect(ceo).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(ceo)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens halls at or below the viewer tier', async () => {
    const onSelect = vi.fn()
    render(
      <SectLadder rungs={RUNGS} viewerTier={tierOf('main-office')} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /修煉場/ }))
    expect(onSelect).toHaveBeenCalledWith('main-office')
  })

  it('says why a hall is locked in words, not only in colour', () => {
    // Colour alone fails every colour-blind reader and every screen reader.
    render(<SectLadder rungs={RUNGS} viewerTier={-1} />)
    expect(screen.getAllByText(/beyond your realm/).length).toBe(RUNGS.length)
  })

  it('marks the current hall for assistive tech', () => {
    render(<SectLadder rungs={RUNGS} viewerTier={9} currentRoom="server-room" />)
    expect(screen.getByRole('button', { name: /陣法室/ })).toHaveAttribute(
      'aria-current', 'true')
  })
})
