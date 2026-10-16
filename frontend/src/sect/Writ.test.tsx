/**
 * Titah — the writ. Its contract is a permission boundary, so the tests are
 * about who may decide, not about how the queue looks.
 *
 * The rule inherited from the old ApprovalGate: no control that is
 * guaranteed to 403 — not a disabled button, none at all, because that is a
 * worse lie than silence. What changed is who it protects. The split used to
 * be guest-versus-owner, inferred from a `redacted` marker on each entry.
 * With one principal, reading the queue and deciding it are the same
 * standing, so the only remaining case is a caller that explicitly says no.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import Writ from './Writ'

const now = Date.now()

const pending = (over = {}) => ({
  id: 'ap-1', kind: 'entry' as const, status: 'pending' as const,
  room: 'ceo-office', agent: 'niu-1', createdAt: now, expiresAt: now + 90_000,
  ...over,
})

function stub(body: unknown, post?: { status: number; body?: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const s = post?.status ?? 200
      return { ok: s < 300, status: s, json: async () => post?.body } as Response
    }
    return { ok: true, status: 200, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('Writ', () => {
  it('shows the queue and offers no decision when the caller forbids it', async () => {
    // `canApprove={false}` is the one remaining way to get a read-only queue.
    // It must suppress the controls entirely, not disable them.
    stub({ pending: [pending()] })
    render(<Writ pollMs={5} canApprove={false} />)
    await waitFor(() => expect(screen.getByText(/1 menunggu keputusan/)).toBeTruthy())
    expect(screen.queryByText('Restui')).toBeNull()
    expect(screen.queryByText('Tolak')).toBeNull()
  })

  it('offers the decision to whoever can read the queue', async () => {
    stub({ pending: [pending()] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    expect(screen.getByText('Tolak')).toBeTruthy()
    expect(screen.getByText('niu-1')).toBeTruthy()
  })

  it('removes a row only when the server accepted the decision', async () => {
    stub({ pending: [pending()] })
    render(<Writ pollMs={100000} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    fireEvent.click(screen.getByText('Restui'))
    await waitFor(() => expect(screen.queryByText('niu-1')).toBeNull())
  })

  it('keeps the row and reports the reason when the server refuses', async () => {
    stub({ pending: [pending()] },
          { status: 409, body: { error: 'Sudah kedaluwarsa' } })
    render(<Writ pollMs={100000} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    fireEvent.click(screen.getByText('Restui'))
    // Dropping the row here would render a decision that never happened.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Sudah kedaluwarsa'))
    expect(screen.getByText('niu-1')).toBeTruthy()
  })

  it('stays out of the way entirely when nothing is waiting', async () => {
    stub({ pending: [] })
    const { container } = render(<Writ pollMs={5} />)
    await waitFor(() => expect(container.querySelector('.sect-writ')).toBeNull())
  })

  it('survives a malformed queue without taking the page down', async () => {
    stub({ pending: 'bukan larik' })
    const { container } = render(<Writ pollMs={5} />)
    await waitFor(() => expect(container.querySelector('.sect-writ')).toBeNull())
  })

  it('counts down in minutes and seconds so an expiring request is visible', async () => {
    stub({ pending: [pending({ expiresAt: now + 95_000 })] })
    render(<Writ pollMs={100000} />)
    await waitFor(() => expect(screen.getByText(/^1m \d+s$/)).toBeTruthy())
  })

  it('matches the shape GET /approvals actually returns', async () => {
    // A fixture carrying keys the server never sends is how the owner's
    // buttons once vanished against the real thing: the component inferred
    // standing from a `redacted` marker that only the fixture produced.
    stub({ pending: [{
      id: 'ap-1', kind: 'entry', status: 'pending', room: 'server-room',
      agent: 'niu-1', createdAt: now, expiresAt: now + 90_000,
    }] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    expect(screen.getByText('niu-1')).toBeTruthy()
  })

  it('withholds every decision, not just the first, when the caller forbids it', async () => {
    stub({ pending: [pending(), pending({ id: 'ap-2' })] })
    render(<Writ pollMs={5} canApprove={false} />)
    await waitFor(() => expect(screen.getByText(/2 menunggu keputusan/)).toBeTruthy())
    expect(screen.queryByText('Restui')).toBeNull()
  })
})
