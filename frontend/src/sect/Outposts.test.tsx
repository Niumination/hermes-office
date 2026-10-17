/**
 * Pos Jaga — the behaviours here are contractual, not cosmetic.
 *
 *   1. `unknown` must never render as a failure. The server distinguishes
 *      "it answered badly" from "we could not ask"; if the UI collapses the
 *      two, the distinction the backend works to preserve is thrown away at
 *      the last step, and operators learn to ignore the colour.
 *   2. Losing the connection must not blank the board or turn it red. The
 *      outposts did not vanish; our view of them did.
 *   3. A signed-out viewer is shown no `detail` — there is none, and the UI
 *      must not reconstruct anything in its place.
 *   4. A viewer without standing sees no control of any kind. Phase two gave the owner buttons,
 *      so the old blanket "no buttons here" rule was rewritten rather than
 *      deleted: the part that still binds is that a non-owner gets no button at
 *      all — not a disabled one, which would advertise a capability and
 *      invite a support ticket.
 *   5. A cooldown is visible before the click, and survives a successful run.
 *      The server reserves the slot before it awaits, so a UI that clears the
 *      cooldown on success offers a button the server answers with 429.
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
    render(<Outposts
        isOwner={false}
        outposts={[post({ state: 'unknown' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    const el = screen.getByTestId('outpost')
    expect(el.getAttribute('data-state')).toBe('unknown')
    expect(screen.getByText('Tak Terjangkau')).toBeTruthy()
    expect(screen.queryByText('Genting')).toBeNull()
  })

  it('distinguishes all four states by text, not only by colour', () => {
    render(
      <Outposts
        isOwner={false}
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
    render(<Outposts
        isOwner={false}
        outposts={[post({ state: 'failed', detail: 'HTTP 500' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText('HTTP 500')).toBeTruthy()
  })

  it('shows the state without inventing a detail the server did not send', () => {
    render(<Outposts
        isOwner={false}
        outposts={[post({ state: 'failed', detail: null })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText('Genting')).toBeTruthy()
    expect(screen.queryByText(/HTTP/)).toBeNull()
  })

  it('says when the view is stale instead of pretending it is live', () => {
    render(<Outposts
        isOwner={false}
        outposts={[post()]} problems={[]} loaded stale lastOkTs={1_760_000_000_000} />)
    expect(screen.getByTestId('outposts-stale')).toBeTruthy()
    // and the last known outpost is still on screen
    expect(screen.getByText('Mitigasi Pagi')).toBeTruthy()
  })

  /**
   * Rewritten 2026-10-15. This test used to assert that the panel had no
   * controls at all, which was the phase-one contract. Phase two gives the
   * owner action buttons, so the assertion was re-aimed at the half that still
   * binds — and it is the more important half. A non-owner must not see a disabled
   * button: that advertises a capability they cannot have.
   */
  it('gives a non-owner no button at all, even when the desk has actions', () => {
    render(
      <Outposts
        isOwner={false}
        outposts={[post({
          state: 'failed',
          actions: [{ id: 'restart', label: 'Mulai ulang', confirm: true, cooldownMs: 60_000 }],
        })]}
        problems={[]} loaded stale={false} lastOkTs={1}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByTestId('outpost-actions')).toBeNull()
    expect(screen.queryByText('Mulai ulang')).toBeNull()
  })

  /**
   * Regression for 2026-10-15: the server attached the action list only to
   * desks it had not probed yet, so this button never appeared in production
   * even though every backend test passed. The UI half is asserted here.
   */
  it('shows the owner a button for each declared action', () => {
    render(
      <Outposts
        isOwner
        outposts={[post({
          actions: [{ id: 'restart', label: 'Mulai ulang', confirm: true, cooldownMs: 60_000 }],
        })]}
        problems={[]} loaded stale={false} lastOkTs={1}
      />,
    )
    expect(screen.getByTestId('action-restart')).toBeTruthy()
    expect(screen.getByText('Mulai ulang')).toBeTruthy()
  })

  /**
   * The binding decision from phase 14 P0: the cooldown is counted from the
   * moment the action starts, not from when it finishes, and it applies
   * whatever the outcome. A run that succeeds in 40 ms still holds the slot.
   * The UI used to clear the cooldown on success, which left an enabled
   * button in front of a server that would answer 429.
   */
  it('keeps the cooldown visible after a run that succeeded', async () => {
    vi.useFakeTimers()
    try {
      const onRunAction = vi.fn().mockResolvedValue({ ok: true, exitCode: 0, ms: 40 })
      render(
        <Outposts
          isOwner
          outposts={[post({
            actions: [{ id: 'restart', label: 'Mulai ulang', confirm: false, cooldownMs: 60_000 }],
          })]}
          problems={[]} loaded stale={false} lastOkTs={1}
          onRunAction={onRunAction}
        />,
      )

      const btn = screen.getByTestId('action-restart') as HTMLButtonElement
      expect(btn.disabled).toBe(false)

      await act(async () => { btn.click() })
      await act(async () => { await Promise.resolve() })

      expect(onRunAction).toHaveBeenCalledWith('a', 'restart')
      const after = screen.getByTestId('action-restart') as HTMLButtonElement
      expect(after.disabled).toBe(true)
      expect(after.getAttribute('title')).toMatch(/^Jeda:/)

      // ...and it releases by itself once the window has actually passed,
      // which a stored duration (rather than a deadline) would never do.
      await act(async () => { vi.advanceTimersByTime(61_000) })
      expect((screen.getByTestId('action-restart') as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the exit code as it came back, not as a verdict', async () => {
    const onRunAction = vi.fn().mockResolvedValue({ ok: false, exitCode: 2, ms: 11 })
    render(
      <Outposts
        isOwner
        outposts={[post({
          actions: [{ id: 'restart', label: 'Mulai ulang', confirm: false, cooldownMs: 0 }],
        })]}
        problems={[]} loaded stale={false} lastOkTs={1}
        onRunAction={onRunAction}
      />,
    )
    await act(async () => { (screen.getByTestId('action-restart') as HTMLButtonElement).click() })
    await waitFor(() => expect(screen.getByText(/exit 2/)).toBeTruthy())
    expect(screen.queryByText(/Berhasil/)).toBeNull()
  })

  it('tells the owner how to configure outposts when there are none', () => {
    render(<Outposts
        isOwner={false}
        outposts={[]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText(/OFFICE_DESKS_FILE/)).toBeTruthy()
  })

  it('surfaces config problems rather than hiding a broken desks.json', () => {
    render(<Outposts
        isOwner={false}
        outposts={[]} problems={['desk "x": probe.url must be http(s)']} loaded stale={false} lastOkTs={1} />)
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

  /**
   * The lookup behind this used to be SECT_HALLS, and anything it did not
   * recognise was dropped — described in the source as "the honest outcome".
   * It was the opposite: the owner wrote a hall name into their own JSON and
   * the screen decided not to repeat it back. These two tests pin both
   * halves: a known room is glossed, an unknown one is still shown.
   */
  it('glosses a hall that names an ecosystem room', () => {
    render(<Outposts
      isOwner={false}
      outposts={[post({ hall: 'infra' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    expect(screen.getByText('Infrastruktur & Monitoring')).toBeTruthy()
  })

  it('still shows a hall it cannot match, rather than dropping it', () => {
    render(<Outposts
      isOwner={false}
      outposts={[post({ hall: 'gudang-belakang' })]} problems={[]} loaded stale={false} lastOkTs={1} />)
    const el = screen.getByText('gudang-belakang')
    expect(el).toBeTruthy()
    expect(el.className).toContain('sect-post__hall--unmatched')
  })
})

