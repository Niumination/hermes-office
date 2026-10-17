/**
 * Presence is the one piece of state where being wrong is worse than being
 * empty: an agent shown as working when it died an hour ago is a false claim
 * about the fleet, and this product sells on not making those.
 *
 * So the tests are about the three ways it can lie, not about the happy path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePresence, WATCHDOG_MS } from './usePresence'

const ok = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response

describe('usePresence', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('seeds from the server snapshot, because the socket has no replay', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { cloud: { online: true, lastSeenTs: 1000 }, mac: { online: false, lastSeenTs: 500 } } }))

    const { result } = renderHook(() => usePresence({ fetchImpl }))

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2))
    expect(result.current.cloud).toEqual({ online: true, lastSeenTs: 1000 })
    expect(result.current.mac).toEqual({ online: false, lastSeenTs: 500 })
    expect(fetchImpl).toHaveBeenCalledWith('/presence', { credentials: 'include' })
  })

  it('keeps the last snapshot when the fetch fails, rather than blanking the fleet', async () => {
    let fail = false
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('network down')
      return ok({ agents: { cloud: { online: true, lastSeenTs: 1000 } } })
    })

    const { result } = renderHook(() => usePresence({ fetchImpl, pollMs: 1000 }))
    await waitFor(() => expect(result.current.cloud?.online).toBe(true))

    // Our own network dying is not evidence that their fleet died.
    fail = true
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(result.current.cloud).toEqual({ online: true, lastSeenTs: 1000 })
  })

  it('re-reads on an interval so a tab left open overnight does not drift', async () => {
    const fetchImpl = vi.fn(async () => ok({ agents: {} }))
    renderHook(() => usePresence({ fetchImpl, pollMs: 1000 }))

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('mirrors the server watchdog: a stale heartbeat goes offline locally', async () => {
    const now = Date.now()
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { cloud: { online: true, lastSeenTs: now - WATCHDOG_MS - 1 } } }))

    const { result } = renderHook(() =>
      usePresence({ fetchImpl, pollMs: 10 * 60_000, tickMs: 500 }))

    await waitFor(() => expect(result.current.cloud?.online).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.cloud?.online).toBe(false)
  })

  it('a fresh heartbeat on the socket keeps an agent online', async () => {
    const now = Date.now()
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { cloud: { online: true, lastSeenTs: now - WATCHDOG_MS - 1 } } }))

    const { result } = renderHook(() =>
      usePresence({ fetchImpl, heartbeats: { cloud: now }, pollMs: 10 * 60_000, tickMs: 500 }))

    await waitFor(() => expect(result.current.cloud?.online).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.cloud?.online).toBe(true)
  })

  /*
    The gap a screenshot caught: the office drew two agents standing in a hall
    while the roster beside it called them silent and printed a last-seen
    stamp older than the heartbeat the page was already holding. The watchdog
    could only ever take a row from online to offline.
  */
  it('revives an agent the snapshot called offline when a beat arrives', async () => {
    const now = Date.now()
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { mac: { online: false, lastSeenTs: now - 20 * 60_000 } } }))

    const { result } = renderHook(() =>
      usePresence({ fetchImpl, heartbeats: { mac: now }, pollMs: 10 * 60_000, tickMs: 500 }))

    await waitFor(() => expect(result.current.mac).toBeDefined())
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.mac?.online).toBe(true)
    expect(result.current.mac?.lastSeenTs).toBe(now)
  })

  it('reports the newest evidence, not whichever side it looked at first', async () => {
    // A stale socket beat must not drag a fresher snapshot backwards.
    const now = Date.now()
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { cloud: { online: true, lastSeenTs: now } } }))

    const { result } = renderHook(() =>
      usePresence({ fetchImpl, heartbeats: { cloud: now - 60_000 }, pollMs: 10 * 60_000, tickMs: 500 }))

    await waitFor(() => expect(result.current.cloud).toBeDefined())
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.cloud?.lastSeenTs).toBe(now)
    expect(result.current.cloud?.online).toBe(true)
  })

  it('does not revive an agent whose only beat is older than the watchdog', async () => {
    // Revival is evidence, not optimism: an expired beat is not a sighting.
    const now = Date.now()
    const fetchImpl = vi.fn(async () =>
      ok({ agents: { mac: { online: false, lastSeenTs: now - 30 * 60_000 } } }))

    const { result } = renderHook(() =>
      usePresence({ fetchImpl, heartbeats: { mac: now - WATCHDOG_MS - 1000 }, pollMs: 10 * 60_000, tickMs: 500 }))

    await waitFor(() => expect(result.current.mac).toBeDefined())
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.mac?.online).toBe(false)
  })

  it('does not invent agents the server did not name', async () => {
    const fetchImpl = vi.fn(async () => ok({}))
    const { result } = renderHook(() => usePresence({ fetchImpl }))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(result.current).toEqual({})
  })
})
