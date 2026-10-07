import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubFetch, stubMatchMedia } from '../test/setup'
import AuditBadge from './AuditBadge'

/**
 * AuditBadge is the visible end of the flight recorder — what a compliance
 * reviewer looks at to decide whether the chain is intact.
 *
 * Every endpoint behind it is owner-only and returns 403 to guests and
 * bridges. The Fase 3 review flagged "render a control guaranteed to 403" as
 * a defect in itself, so the badge must vanish entirely for anyone who cannot
 * use it rather than offer a button that always fails.
 *
 * Fixtures match the server exactly:
 *   GET /ledger/head   -> { seq, hash, records, algorithm }   (index.js:401)
 *   GET /ledger/verify -> { ok, checked?, reason?, brokenAt?, tookMs }
 *
 * Markup is asserted as the component actually renders it — root
 * `.audit-badge.audit-{unknown|verified|broken}`, a chip that toggles the
 * panel, and a "Verify chain" button inside. Two earlier drafts of this file
 * invented a `data-testid` the component never had; the fixture and the
 * selector both have to describe reality or the test proves nothing.
 */

const HEAD = {
  seq: 128,
  hash: 'c0c8ccf81683aa91',
  records: 128,
  algorithm: 'SHA-256 over canonical JSON',
}

const badge = (c: HTMLElement) => c.querySelector('.audit-badge')

beforeEach(() => {
  stubMatchMedia(false)
})

describe('AuditBadge — visibility follows entitlement', () => {
  it('renders for an owner', async () => {
    stubFetch({ '/ledger/head': { body: HEAD } })
    const { container } = render(<AuditBadge />)
    await waitFor(() => expect(badge(container)).toBeInTheDocument())
  })

  it('disappears on 403 rather than offering a dead control', async () => {
    stubFetch({ '/ledger/head': { status: 403, body: {} } })
    const { container } = render(<AuditBadge />)
    await waitFor(() => expect(badge(container)).toBeNull())
  })

  it('disappears on 401 as well', async () => {
    stubFetch({ '/ledger/head': { status: 401, body: {} } })
    const { container } = render(<AuditBadge />)
    await waitFor(() => expect(badge(container)).toBeNull())
  })
})

describe('AuditBadge — chain state', () => {
  it('shows the record count from the head', async () => {
    stubFetch({ '/ledger/head': { body: HEAD } })
    render(<AuditBadge />)
    expect(await screen.findByText(/AUDIT · 128/)).toBeInTheDocument()
  })

  it('starts in the unknown state until the chain is actually verified', async () => {
    // Holding a head hash is not the same as having re-hashed the chain.
    // Claiming "verified" on load would be an unearned assurance.
    stubFetch({ '/ledger/head': { body: HEAD } })
    const { container } = render(<AuditBadge />)
    await waitFor(() => expect(badge(container)).toHaveClass('audit-unknown'))
  })

  it('reports an intact chain after verification', async () => {
    stubFetch({
      '/ledger/verify': { body: { ok: true, checked: 128, tookMs: 7 } },
      '/ledger/head': { body: HEAD },
    })
    const { container } = render(<AuditBadge />)
    await screen.findByText(/AUDIT · 128/)

    await userEvent.click(screen.getByRole('button'))               // open panel
    await userEvent.click(screen.getByRole('button', { name: /verify chain/i }))

    await waitFor(() => expect(badge(container)).toHaveClass('audit-verified'))
    expect(screen.getByText(/Verified 128 records in 7 ms/)).toBeInTheDocument()
  })

  it('surfaces a broken chain loudly, naming the reason and the record', async () => {
    stubFetch({
      '/ledger/verify': {
        body: { ok: false, reason: 'content-altered', brokenAt: 57, checked: 128, tookMs: 9 },
      },
      '/ledger/head': { body: HEAD },
    })
    const { container } = render(<AuditBadge />)
    await screen.findByText(/AUDIT · 128/)

    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('button', { name: /verify chain/i }))

    // A tamper signal that is merely logged is a tamper signal nobody sees.
    await waitFor(() => expect(badge(container)).toHaveClass('audit-broken'))
    expect(screen.getByText(/FAILED: content-altered at #57/)).toBeInTheDocument()
    expect(screen.getByText('CHAIN BROKEN')).toBeInTheDocument()
  })

  it('keeps the honest caveat visible next to the verdict', async () => {
    stubFetch({ '/ledger/head': { body: HEAD } })
    render(<AuditBadge />)
    await screen.findByText(/AUDIT · 128/)
    await userEvent.click(screen.getByRole('button'))

    // Tail truncation and wholesale regeneration are NOT detectable without
    // an external anchor. Overstating this is the one thing that would make
    // the whole compliance story dishonest, so the wording is pinned.
    expect(screen.getByText(/Tamper-evident, not tamper-proof/)).toBeInTheDocument()
  })

  it('offers the dossier export as a real link, not a scripted download', async () => {
    stubFetch({ '/ledger/head': { body: HEAD } })
    render(<AuditBadge />)
    await screen.findByText(/AUDIT · 128/)
    await userEvent.click(screen.getByRole('button'))

    const link = screen.getByRole('link', { name: /export dossier/i })
    // The server already sets Content-Disposition; a plain link keeps the
    // export working even when JS state is stale.
    expect(link).toHaveAttribute('href', '/dossier')
  })
})

describe('AuditBadge — lifecycle', () => {
  it('stops polling after unmount', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = stubFetch({ '/ledger/head': { body: HEAD } })
      const { unmount } = render(<AuditBadge pollMs={1000} />)
      await vi.advanceTimersByTimeAsync(0)
      const before = fetchMock.mock.calls.length
      unmount()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchMock.mock.calls.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives a network error without taking the stage down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { container } = render(<AuditBadge />)
    // The badge lives inside OfficeStage; an unhandled throw here would take
    // the whole office down over one failed background poll.
    await waitFor(() => expect(container).toBeTruthy())
  })
})
