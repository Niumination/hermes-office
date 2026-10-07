import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubFetch, stubMatchMedia } from '../test/setup'
import ApprovalGate from './ApprovalGate'

/**
 * ApprovalGate is a governance surface, not decoration.
 *
 * Since the auto-guest middleware landed, "guest" and "anonymous visitor on
 * the public internet" are the same principal. The server redacts `agent` and
 * `tool` out of /approvals for guests, and this component infers the viewer's
 * role from that redaction rather than making a second request. If that
 * inference breaks, one of two things happens, and both are bad: a guest is
 * shown approve/deny buttons that are guaranteed to 403, or an owner is
 * silently denied the controls they are entitled to.
 *
 * These tests pin the redaction contract from the component's side. The
 * server side is already pinned by tests/integration.test.js.
 */

// The server wraps the list: GET /approvals -> { pending: [...] }
// (server/index.js:515). An earlier draft of these tests asserted against a
// bare array and failed — the fixture was wrong, not the component. Keeping
// the real envelope here is the point: a test fixture that does not match the
// server proves nothing.
const OWNER_APPROVAL = {
  id: 'ap-1-abc',
  kind: 'tool' as const,
  room: 'server-room',
  agent: 'deployer',
  tool: 'kubectl',
  status: 'pending',
  createdAt: Date.now(),
  expiresAt: Date.now() + 300_000,
}

// Exactly what the server sends a guest: identifying fields absent, and a
// redacted marker. Note `agent` and `tool` are missing, not empty strings.
const GUEST_APPROVAL = {
  id: 'ap-1-abc',
  kind: 'tool' as const,
  room: 'server-room',
  status: 'pending',
  createdAt: Date.now(),
  expiresAt: Date.now() + 300_000,
  redacted: true,
}

beforeEach(() => {
  stubMatchMedia(false)
})

describe('ApprovalGate — owner view', () => {
  it('shows the agent and tool an owner is entitled to see', async () => {
    stubFetch({ '/approvals': { body: { pending: [OWNER_APPROVAL] } } })
    render(<ApprovalGate />)

    expect(await screen.findByText('deployer')).toBeInTheDocument()
    expect(screen.getByText('kubectl')).toBeInTheDocument()
  })

  it('offers approve and deny controls', async () => {
    stubFetch({ '/approvals': { body: { pending: [OWNER_APPROVAL] } } })
    render(<ApprovalGate />)

    await screen.findByText('deployer')
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
  })

  it('posts the decision to the approval endpoint', async () => {
    const fetchMock = stubFetch({
      '/approvals/ap-1-abc': { body: { ok: true } },
      '/approvals': { body: { pending: [OWNER_APPROVAL] } },
    })
    render(<ApprovalGate />)
    await screen.findByText('deployer')

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() => {
      const posted = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/approvals/ap-1-abc')
      )
      expect(posted).toBeTruthy()
      expect((posted?.[1] as RequestInit)?.method).toBe('POST')
    })
  })
})

describe('ApprovalGate — guest view', () => {
  it('never renders the agent or the tool', async () => {
    stubFetch({ '/approvals': { body: { pending: [GUEST_APPROVAL] } } })
    render(<ApprovalGate />)

    // The room is public; the privilege map is not.
    expect(await screen.findByText(/server-room/)).toBeInTheDocument()
    expect(screen.queryByText('deployer')).not.toBeInTheDocument()
    expect(screen.queryByText('kubectl')).not.toBeInTheDocument()
  })

  it('hides controls that would be guaranteed to 403', async () => {
    stubFetch({ '/approvals': { body: { pending: [GUEST_APPROVAL] } } })
    render(<ApprovalGate />)

    await screen.findByText(/server-room/)
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument()
  })

  it('does not leak privileged words anywhere in the rendered output', async () => {
    stubFetch({ '/approvals': { body: { pending: [GUEST_APPROVAL] } } })
    const { container } = render(<ApprovalGate />)
    await screen.findByText(/server-room/)

    // A broad sweep rather than field-by-field assertions: redaction that
    // leaks through an attribute, a title or a data-* would pass narrower
    // checks while still exposing the privilege map in the DOM.
    const html = container.innerHTML
    for (const secret of ['deployer', 'kubectl', 'terraform', 'grantedBy']) {
      expect(html).not.toContain(secret)
    }
  })
})

describe('ApprovalGate — resilience', () => {
  it('renders nothing when there is nothing pending', async () => {
    stubFetch({ '/approvals': { body: { pending: [] } } })
    const { container } = render(<ApprovalGate />)
    await waitFor(() => expect(container.querySelector('.approval-gate')).toBeNull())
  })

  it('stays silent when the endpoint fails rather than showing a broken gate', async () => {
    stubFetch({ '/approvals': { status: 500, body: {} } })
    const { container } = render(<ApprovalGate />)
    await waitFor(() => expect(container.querySelector('.approval-gate')).toBeNull())
  })

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = stubFetch({ '/approvals': { body: { pending: [OWNER_APPROVAL] } } })
      const { unmount } = render(<ApprovalGate pollMs={1000} />)
      await vi.advanceTimersByTimeAsync(0)
      const before = fetchMock.mock.calls.length
      unmount()
      await vi.advanceTimersByTimeAsync(5000)
      // A timer that outlives its component keeps an unmounted tree alive and
      // keeps hitting the server for a view nobody is looking at.
      expect(fetchMock.mock.calls.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
