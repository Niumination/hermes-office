/**
 * Titah — the writ. Its contract is a permission boundary, so the tests are
 * about who may decide, not about how the queue looks.
 *
 * The rule inherited from the old ApprovalGate and kept verbatim: knowing
 * that something waits is not privileged; deciding it is. A guest sees the
 * queue and gets no buttons — not disabled buttons, none — because a control
 * guaranteed to 403 is a worse lie than silence.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import Writ from './Writ'

const now = Date.now()

const pending = (over = {}) => ({
  id: 'ap-1', kind: 'entry' as const, status: 'pending' as const,
  room: 'ceo-office', createdAt: now, expiresAt: now + 90_000,
  redacted: true, ...over,
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
  it('shows a guest the queue but offers no decision', async () => {
    stub({ pending: [pending()] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText(/1 menunggu keputusan/)).toBeTruthy())
    expect(screen.queryByText('Restui')).toBeNull()
    expect(screen.queryByText('Tolak')).toBeNull()
  })

  it('offers the decision once the server sends unredacted detail', async () => {
    stub({ pending: [pending({ redacted: false, agent: 'niu-1' })] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    expect(screen.getByText('Tolak')).toBeTruthy()
    expect(screen.getByText('niu-1')).toBeTruthy()
  })

  it('removes a row only when the server accepted the decision', async () => {
    stub({ pending: [pending({ redacted: false, agent: 'niu-1' })] })
    render(<Writ pollMs={100000} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    fireEvent.click(screen.getByText('Restui'))
    await waitFor(() => expect(screen.queryByText('niu-1')).toBeNull())
  })

  it('keeps the row and reports the reason when the server refuses', async () => {
    stub({ pending: [pending({ redacted: false, agent: 'niu-1' })] },
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

  it('offers the decision when the server omits `redacted` entirely', async () => {
    // This is what GET /approvals actually returns to an owner: the raw
    // approval object, with no `redacted` key at all. A fixture that sends
    // `redacted: false` tests a response the server never produces — and that
    // gap hid a bug that removed the owner's buttons against the real server.
    stub({ pending: [{
      id: 'ap-1', kind: 'entry', status: 'pending', room: 'server-room',
      agent: 'niu-1', createdAt: now, expiresAt: now + 90_000,
    }] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText('Restui')).toBeTruthy())
    expect(screen.getByText('niu-1')).toBeTruthy()
  })

  it('still withholds the decision when every entry is marked redacted', async () => {
    stub({ pending: [pending(), pending({ id: 'ap-2' })] })
    render(<Writ pollMs={5} />)
    await waitFor(() => expect(screen.getByText(/2 menunggu keputusan/)).toBeTruthy())
    expect(screen.queryByText('Restui')).toBeNull()
  })
})
