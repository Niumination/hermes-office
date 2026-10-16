/**
 * Tests for the Amanat board overlay.
 *
 * Carried over from Amanat.test.tsx (the panel this replaces) so the
 * guarantees survive the change of shape: blocked-first ordering,
 * redaction, the empty state, and the fact that counts stay visible even
 * when titles are hidden.
 *
 * Added for the overlay form: backdrop click closes, clicks inside do not,
 * Escape closes, and the dialog is labelled.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AmanatBoard from './AmanatBoard'
import type { Amanat, AmanatState, LaneId } from './useAmanat'

const NOW = 1_760_000_000_000

function task(over: Partial<Amanat> = {}): Amanat {
  const base: Amanat = {
    id: 't1',
    title: 'Perbaiki gerbang',
    state: 'working',
    agent: 'cloud',
    origin: 'whatsapp',
    repo: 'hermes-office',
    blocked: false,
    updatedTs: NOW - 60_000,
    createdTs: NOW - 300_000,
    lane: 'active',
    peer: null,
  }
  return { ...base, ...over }
}

function board(over: Partial<AmanatState> = {}): AmanatState {
  const lanes: Record<LaneId, Amanat[]> = {
    blocked: [],
    active: [],
    queued: [],
    done: [],
    stopped: [],
  }
  const base: AmanatState = {
    order: ['blocked', 'active', 'queued', 'done', 'stopped'],
    lanes,
    counts: { blocked: 0, active: 0, queued: 0, done: 0, stopped: 0 },
    total: 0,
    blocked: 0,
    stale: false,
    loaded: true,
    lastOkTs: NOW,
    refresh: async () => {},
  }
  return { ...base, ...over }
}

describe('AmanatBoard', () => {
  it('renders every lane as its own column, blocked first', () => {
    // A board with any task at all shows columns; an empty board shows the
    // empty state instead, which the empty-state test covers.
    const b = board({ total: 1 })
    b.lanes.active = [task()]
    render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    const heads = screen.getAllByRole('heading', { level: 4 })
    expect(heads.map((h) => h.textContent)).toEqual([
      'Tertahan',
      'Dikerjakan',
      'Menunggu giliran',
      'Selesai',
      'Terhenti',
    ])
  })

  it('places a task in its lane with agent and age', () => {
    const b = board({ total: 1 })
    b.lanes.active = [task()]
    render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    expect(screen.getByText('Perbaiki gerbang')).toBeTruthy()
    expect(screen.getByText('1 mnt')).toBeTruthy()
    expect(screen.getByText('lewat WhatsApp')).toBeTruthy()
  })

  it('marks a blocked card so it reads as needing the operator', () => {
    const b = board({ total: 1, blocked: 1 })
    b.lanes.blocked = [task({ blocked: true, state: 'input_required' })]
    const { container } = render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    expect(container.querySelector('.amanat-card--blocked')).toBeTruthy()
    expect(screen.getByText(/1 menunggu Anda/)).toBeTruthy()
  })

  it('falls back to the id for a task that genuinely has no title', () => {
    // The board used to print "[tersembunyi]" here, because a guest received
    // every title stripped. Nothing strips titles now, so a null title means
    // the task was filed without one and the id is the only true label.
    const b = board({ total: 2 })
    b.lanes.active = [
      task({ id: 'a', title: null, repo: null }),
      task({ id: 'b', title: null, repo: null }),
    ]
    render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    const col = document.querySelector('.amanat-col--active')!
    expect(within(col as HTMLElement).getByText('2')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    expect(screen.queryByText('[tersembunyi]')).toBeNull()
  })

  it('explains the empty state instead of showing bare zeroes', () => {
    render(<AmanatBoard board={board()} onClose={() => {}} now={NOW} />)
    expect(screen.getByText('Belum ada amanat.')).toBeTruthy()
    expect(screen.getByText(/hermes-emit/)).toBeTruthy()
  })

  it('says when the board is not connected rather than implying it is current', () => {
    const b = board({ total: 1, stale: true })
    b.lanes.active = [task()]
    render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    expect(screen.getByText(/tak tersambung/)).toBeTruthy()
  })

  it('closes on backdrop click, the close button, and Escape', () => {
    const onClose = vi.fn()
    const { container } = render(
      <AmanatBoard board={board()} onClose={onClose} now={NOW} />,
    )
    fireEvent.click(container.querySelector('.amanat-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Tutup papan'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('does not close when the board itself is clicked', () => {
    const onClose = vi.fn()
    render(<AmanatBoard board={board()} onClose={onClose} now={NOW} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('labels the dialog for assistive tech', () => {
    render(<AmanatBoard board={board()} onClose={() => {}} now={NOW} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Papan Amanat')
  })

  it('builds initials from an agent id without inventing a name', () => {
    const b = board({ total: 1 })
    b.lanes.active = [task({ agent: 'frontend-developer' })]
    render(<AmanatBoard board={b} onClose={() => {}} now={NOW} />)
    expect(screen.getByText('FD')).toBeTruthy()
    expect(screen.getByText('frontend-developer')).toBeTruthy()
  })
})
