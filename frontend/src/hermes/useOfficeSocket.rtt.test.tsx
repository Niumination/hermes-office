/**
 * RTT (latency) tests for useOfficeSocket.
 *
 * The ping interval is the only feature the socket hook adds beyond connect:
 * once a second there and back tells you a "connected" light is not hiding a
 * saturated link. Two things must hold:
 *
 *   1. A pong replies to *our* ping, measured on *our* clock.
 *   2. Reconnect resets it — a stale latency next to a fresh connection is a
 *      lie, and it is the exact kind this repo does not ship.
 *
 * Real timers (no fakes): AGENTS.md §6 — poll for "it happened". The interval
 * is injected short so the test does not wait 30s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOfficeSocket } from './useOfficeSocket'

/** Short enough for a real-timer test; the default 30s would time out. */
const FAST_PING_MS = 5

/** A minimal in-memory WebSocket double: only what the ping loop touches. */
class FakeSocket {
  static instances: FakeSocket[] = []
  static ctor: ReturnType<typeof vi.fn>

  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false

  constructor() {
    this.readyState = 1
    FakeSocket.instances.push(this)
    // The real WebSocket fires open asynchronously; the hook assigns handlers
    // synchronously inside connect(), so a microtask lands after them.
    queueMicrotask(() => {
      if (this.closed) return
      this.onopen?.()
    })
  }
  send(data: string) {
    if (this.readyState !== 1) return
    this.sent.push(data)
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = 3
    this.onclose?.()
  }
}

function mockWebSocket() {
  FakeSocket.instances = []
  // Must be a real function/class expression: `new` on an arrow fn yields
  // "not a constructor", and the hook calls `new WebSocket(url)`.
  FakeSocket.ctor = vi.fn(function (this: FakeSocket) { return new FakeSocket() })
  vi.stubGlobal('WebSocket', FakeSocket.ctor)
}

function recvPong(ws: FakeSocket) {
  ws.onmessage?.({ data: JSON.stringify({ channel: 'pong', data: { ts: Date.now() } }) })
}

describe('useOfficeSocket — RTT', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('measures a round trip only after our ping is answered', async () => {
    mockWebSocket()
    const { result } = renderHook(() => useOfficeSocket({ pingMs: FAST_PING_MS }))

    await waitFor(() => expect(result.current.connected).toBe(true))
    expect(result.current.rttMs).toBeNull()

    // The ping loop fires on its own; wait for it to have sent exactly one.
    const ws = FakeSocket.instances[0]
    await waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(1))
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'ping' })

    recvPong(ws)
    await waitFor(() => expect(result.current.rttMs).not.toBeNull())
    expect(result.current.rttMs).toBeGreaterThanOrEqual(0)
  })

  it('does not report latency when the socket is closed', async () => {
    mockWebSocket()
    const { result, unmount } = renderHook(() => useOfficeSocket({ pingMs: FAST_PING_MS }))

    await waitFor(() => expect(result.current.connected).toBe(true))
    const ws = FakeSocket.instances[0]
    await waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(1))
    recvPong(ws)
    await waitFor(() => expect(result.current.rttMs).not.toBeNull())

    // Close: the hook must forget the latency, not keep flattering itself.
    act(() => { ws.close() })
    await waitFor(() => expect(result.current.connected).toBe(false))
    expect(result.current.rttMs).toBeNull()

    unmount()
  })
})
