import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { stubFetch } from '../test/setup'
import { useBurnState } from './useBurnState'
import type { HermesEnvelope } from './types'

/**
 * useBurnState replaced two independent timers that polled /burn ~1,440 times
 * an hour per tab for data the server already pushes. These tests exist to
 * stop that regressing, because a polling loop is the easiest thing in the
 * world to reintroduce and the hardest to notice: everything still works, it
 * just costs a request a second forever.
 *
 * They also pin the two reasons the socket cannot be the only source — no
 * history replay, and no dollar figures in budget_state.
 */

const SNAPSHOT = {
  global: {
    state: 'warm',
    ratio: 0.6,
    spentHourUsd: 0.3,
    spentDayUsd: 0.3,
    limitHourUsd: 0.5,
    limitDayUsd: null,
    lifetimeUsd: 0.3,
  },
  agents: [],
}

const env = (e: Partial<HermesEnvelope>): HermesEnvelope =>
  ({ type: 'budget_state', ...e } as HermesEnvelope)

beforeEach(() => {
  vi.useRealTimers()
})

describe('useBurnState — seeding', () => {
  it('seeds once from /burn because the socket replays no history', async () => {
    const fetchMock = stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result } = renderHook(() => useBurnState([]))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.state).toBe('warm')
    expect(result.current.snapshot?.global.spentHourUsd).toBe(0.3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports normal before the seed lands rather than rendering undefined', () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result } = renderHook(() => useBurnState([]))
    expect(result.current.state).toBe('normal')
  })

  it('keeps the last known figures when a refresh fails', async () => {
    stubFetch({ '/burn': { status: 500, body: {} } })
    const { result } = renderHook(() => useBurnState([]))
    await waitFor(() => expect(result.current.ready).toBe(true))
    // Blanking the HUD because one request failed is worse than figures that
    // are a few seconds stale.
    expect(result.current.state).toBe('normal')
    expect(result.current.snapshot).toBeNull()
  })
})

describe('useBurnState — no polling', () => {
  it('issues no further requests while the state is steady', async () => {
    const fetchMock = stubFetch({ '/burn': { body: SNAPSHOT } })
    const { rerender, result } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    // Several renders with no transition: the old implementation would have
    // fired a request every 3-5 seconds here.
    for (let i = 0; i < 5; i++) rerender({ e: [] })
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('useBurnState — live transitions', () => {
  it('adopts a pushed state immediately, without waiting for a round trip', async () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    rerender({ e: [env({ state: 'critical' })] })
    // The label drives the room lighting, so it must not lag the socket.
    await waitFor(() => expect(result.current.state).toBe('critical'))
  })

  it('refetches the figures only when a transition actually happens', async () => {
    const fetchMock = stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ e: [env({ state: 'hot' })] })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('takes the last transition when a batch carries several', async () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.ready).toBe(true))

    rerender({
      e: [env({ state: 'warm' }), env({ state: 'hot' }), env({ state: 'critical' })],
    })
    // Intermediate hops inside one batch are already superseded.
    await waitFor(() => expect(result.current.state).toBe('critical'))
  })

  it('ignores agent-scoped transitions for the global reading', async () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.state).toBe('warm'))

    rerender({ e: [env({ state: 'tripped', scope: 'agent' })] })
    await new Promise((r) => setTimeout(r, 30))
    // One agent hitting its own cap must not set the whole room on fire.
    expect(result.current.state).toBe('warm')
  })

  it('ignores envelopes that are not budget_state', async () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.state).toBe('warm'))

    rerender({ e: [env({ type: 'tool_call', state: 'tripped' })] })
    await new Promise((r) => setTimeout(r, 30))
    expect(result.current.state).toBe('warm')
  })

  it('rejects a state value the server should never send', async () => {
    stubFetch({ '/burn': { body: SNAPSHOT } })
    const { result, rerender } = renderHook(({ e }) => useBurnState(e), {
      initialProps: { e: [] as HermesEnvelope[] },
    })
    await waitFor(() => expect(result.current.state).toBe('warm'))

    rerender({ e: [env({ state: 'on-fire' })] })
    await new Promise((r) => setTimeout(r, 30))
    // An unknown label would reach the shader's grade lookup and fall through
    // to undefined, so it is filtered at the boundary instead.
    expect(result.current.state).toBe('warm')
  })
})
