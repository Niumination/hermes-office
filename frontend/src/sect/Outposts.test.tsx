/**
 * Pos Jaga — the behaviours here are contractual, not cosmetic.
 *
 *   1. `unknown` must never render as a failure. The server distinguishes
 *      "it answered badly" from "we could not ask"; if the UI collapses the
 *      two, the distinction the backend works to preserve is thrown away at
 *      the last step, and operators learn to ignore the colour.
 *   2. Losing the connection must not blank the board or turn it red. The
 *      outposts did not vanish; our view of them did.
 *   3. A guest must not be shown `detail` — the server nulls it, and the UI
 *      must not reconstruct anything in its place.
 *   4. No control may appear here. Phase one is observation only; a button
 *      that cannot work is worse than no button.
 */
import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Outposts from './Outposts'
import { useOutposts } from './useOutposts'
import type { Outpost } from './useOutposts'

const post = (over: Partial<Outpost> = {}): Outpost => ({
  id: 'a', label: 'Mitigasi Pagi', hall: null, note: null, kind: 'http',
  state: 'ok', lastTs: 1_760_000_000_000, checkedTs: 1_760_000_000_000,
  detail: null, ...over,
})

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

describe('Outposts — panel', () => {
  it('renders an unknown outpost as its own state, not as a failure', () => {
    render(<Outposts outposts={[post({ state: 'unknown' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    const el = screen.getByTestId('outpost')
    expect(el.getAttribute('data-state')).toBe('unknown')
    expect(screen.getByText('Tak Terjangkau')).toBeTruthy()
    expect(screen.queryByText('Genting')).toBeNull()
  })

  it('distinguishes all four states by text, not only by colour', () => {
    render(
      <Outposts
        outposts={[
          post({ id: 'a', state: 'ok' }),
          post({ id: 'b', state: 'failed' }),
          post({ id: 'c', state: 'stale' }),
          post({ id: 'd', state: 'unknown' }),
        ]}
        problems={[]} loaded stale={false} lastOkTs={1}
      />,
    )
    for (const label of ['Aman', 'Genting', 'Senyap', 'Tak Terjangkau']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('shows the detail string when the server sent one', () => {
    render(<Outposts outposts={[post({ state: 'failed', detail: 'HTTP 500' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText('HTTP 500')).toBeTruthy()
  })

  it('shows nothing extra when the server redacted the detail for a guest', () => {
    render(<Outposts outposts={[post({ state: 'failed', detail: null, redacted: true })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText('Genting')).toBeTruthy()
    expect(screen.queryByText(/HTTP/)).toBeNull()
  })

  it('says when the view is stale instead of pretending it is live', () => {
    render(<Outposts outposts={[post()]} problems={[]} loaded stale lastOkTs={1_760_000_000_000} />)
    expect(screen.getByTestId('outposts-stale')).toBeTruthy()
    // and the last known outpost is still on screen
    expect(screen.getByText('Mitigasi Pagi')).toBeTruthy()
  })

  it('offers no control of any kind — phase one is observation only', () => {
    render(
      <Outposts
        outposts={[post({ state: 'failed' })]} problems={[]} loaded stale={false} lastOkTs={1}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('tells the owner how to configure outposts when there are none', () => {
    render(<Outposts outposts={[]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText(/OFFICE_DESKS_FILE/)).toBeTruthy()
  })

  it('surfaces config problems rather than hiding a broken desks.json', () => {
    render(<Outposts outposts={[]} problems={['desk "x": probe.url must be http(s)']} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByTestId('outposts-problems').textContent).toContain('must be http')
  })
})

describe('useOutposts', () => {
  it('loads the snapshot from GET /desks', async () => {
    const fetchImpl = vi.fn(async (_u: string) =>
      jsonRes({ desks: [{ id: 'a', label: 'A', state: 'ok', kind: 'http' }], problems: [] }))
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts).toHaveLength(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('/desks')
  })

  it('downgrades an unrecognised state to unknown, never to ok', async () => {
    const fetchImpl = vi.fn(async (_u: string) =>
      jsonRes({ desks: [{ id: 'a', state: 'definitely-fine', kind: 'http' }] }))
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts[0].state).toBe('unknown')
  })

  it('keeps the previous snapshot when the office becomes unreachable', async () => {
    let fail = false
    const fetchImpl = vi.fn(async (_u: string) => {
      if (fail) throw new Error('offline')
      return jsonRes({ desks: [{ id: 'a', label: 'A', state: 'ok', kind: 'http' }] })
    })
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts).toHaveLength(1)

    fail = true
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts).toHaveLength(1)   // not blanked
    expect(result.current.outposts[0].state).toBe('ok') // not turned red
    expect(result.current.stale).toBe(true)             // but flagged as old
  })

  it('treats a 401 as "no session yet", not as an empty board', async () => {
    const fetchImpl = vi.fn(async (_u: string) => jsonRes({}, 401))
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts).toHaveLength(0)
    expect(result.current.stale).toBe(true)
  })

  it('ignores a malformed desk instead of crashing the panel', async () => {
    const fetchImpl = vi.fn(async (_u: string) =>
      jsonRes({ desks: [null, { nope: true }, { id: 'ok1', state: 'ok', kind: 'file' }] }))
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    await act(async () => { await result.current.refresh() })
    expect(result.current.outposts).toHaveLength(1)
    expect(result.current.outposts[0].id).toBe('ok1')
  })

  it('records when the last good answer arrived', async () => {
    const fetchImpl = vi.fn(async (_u: string) => jsonRes({ desks: [] }))
    const { result } = renderHook(() => useOutposts({ fetchImpl, autoStart: false }))
    expect(result.current.lastOkTs).toBeNull()
    await act(async () => { await result.current.refresh() })
    expect(typeof result.current.lastOkTs).toBe('number')
  })
})
