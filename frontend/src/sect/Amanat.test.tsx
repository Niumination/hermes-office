/**
 * Amanat — the panel that answers "what is being worked on".
 *
 * Three of its behaviours are contractual rather than cosmetic:
 *
 *   1. An empty board must read as "nothing is running", never as a failed
 *      fetch. The whole value of this panel is that silence is trustworthy.
 *   2. A redacted task must still occupy a row. Hiding it would misreport a
 *      busy fleet as idle to a guest, which is a different and worse lie than
 *      "you may not read this".
 *   3. `Tertahan` renders first. It is the only lane the operator can clear.
 */
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import Amanat from './Amanat'
import { useAmanat, type AmanatState, type Amanat as Task } from './useAmanat'

const task = (over: Partial<Task> = {}): Task => ({
  id: 'T1',
  state: 'working',
  lane: 'active',
  agent: 'cloud',
  origin: 'telegram',
  title: 'repo lightvela: perbaiki build',
  repo: 'lightvela',
  peer: null,
  createdTs: 1000,
  updatedTs: 1000,
  blocked: false,
  ...over,
})

const board = (over: Partial<AmanatState> = {}): AmanatState => {
  const lanes = {
    blocked: [], active: [], queued: [], done: [], stopped: [],
    ...(over.lanes ?? {}),
  } as AmanatState['lanes']
  const counts = Object.fromEntries(
    Object.entries(lanes).map(([k, v]) => [k, v.length]),
  ) as AmanatState['counts']
  return {
    lanes,
    counts,
    order: ['blocked', 'active', 'queued', 'done', 'stopped'],
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    blocked: counts.blocked,
    redacted: false,
    loaded: true,
    stale: false,
    lastOkTs: 1000,
    refresh: async () => {},
    ...over,
  }
}

describe('Amanat panel', () => {
  it('says nothing is running, not that something broke', () => {
    render(<Amanat board={board()} />)
    expect(screen.getByText(/Belum ada amanat/i)).toBeTruthy()
    // and points at the thing that would make it fill
    expect(screen.getByText(/task_update/)).toBeTruthy()
  })

  it('distinguishes "still loading" from "nothing is running"', () => {
    render(<Amanat board={board({ loaded: false })} />)
    expect(screen.getByText(/Memuat amanat/i)).toBeTruthy()
    expect(screen.queryByText(/Belum ada amanat/i)).toBeNull()
  })

  it('renders the blocked lane before every other lane', () => {
    const { container } = render(
      <Amanat
        board={board({
          lanes: {
            blocked: [task({ id: 'B1', state: 'input_required', lane: 'blocked', blocked: true, title: 'tertahan' })],
            active: [task({ id: 'A1' })],
            queued: [], done: [], stopped: [],
          } as AmanatState['lanes'],
        })}
      />,
    )
    const lanes = [...container.querySelectorAll('.sect-amanat__lane')]
    expect(lanes[0].className).toContain('sect-amanat__lane--blocked')
  })

  it('surfaces how many tasks are waiting on the operator', () => {
    render(
      <Amanat
        board={board({
          lanes: {
            blocked: [
              task({ id: 'B1', lane: 'blocked', state: 'input_required', blocked: true }),
              task({ id: 'B2', lane: 'blocked', state: 'auth_required', blocked: true }),
            ],
            active: [], queued: [], done: [], stopped: [],
          } as AmanatState['lanes'],
        })}
      />,
    )
    expect(screen.getByText('2 menunggu Anda')).toBeTruthy()
  })

  it('keeps a redacted task visible instead of dropping it', () => {
    render(
      <Amanat
        board={board({
          redacted: true,
          lanes: {
            blocked: [], queued: [], done: [], stopped: [],
            active: [task({ title: null, repo: null, redacted: true })],
          } as AmanatState['lanes'],
        })}
      />,
    )
    expect(screen.getByText('[tersembunyi]')).toBeTruthy()
    expect(screen.getByText(/judul disembunyikan/i)).toBeTruthy()
    // the shape of the work is still reported
    expect(screen.getByText('1 amanat')).toBeTruthy()
  })

  it('never prints a project name it was not given', () => {
    const { container } = render(
      <Amanat
        board={board({
          redacted: true,
          lanes: {
            blocked: [], queued: [], done: [], stopped: [],
            active: [task({ title: '[redacted]', repo: '[redacted]' })],
          } as AmanatState['lanes'],
        })}
      />,
    )
    expect(container.textContent).not.toContain('lightvela')
  })

  it('shows where the work came from in words', () => {
    render(
      <Amanat
        board={board({
          lanes: {
            blocked: [], queued: [], done: [], stopped: [],
            active: [task({ origin: 'whatsapp' })],
          } as AmanatState['lanes'],
        })}
      />,
    )
    expect(screen.getByText(/lewat WhatsApp/)).toBeTruthy()
  })

  it('marks the board stale without blanking it', () => {
    render(
      <Amanat
        board={board({
          stale: true,
          lanes: {
            blocked: [], queued: [], done: [], stopped: [],
            active: [task({ title: 'masih terlihat' })],
          } as AmanatState['lanes'],
        })}
      />,
    )
    expect(screen.getByText('tak tersambung')).toBeTruthy()
    expect(screen.getByText('masih terlihat')).toBeTruthy()
  })
})

describe('useAmanat', () => {
  const ok = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)

  it('drops a row with an unknown state rather than guessing a lane', async () => {
    const fetchImpl = vi.fn(() =>
      ok({
        lanes: {
          active: [
            { id: 'good', state: 'working', lane: 'active', createdTs: 1, updatedTs: 1 },
            { id: 'bad', state: 'teleportasi', lane: 'active', createdTs: 1, updatedTs: 1 },
            { id: 'no-id-state', lane: 'active' },
          ],
        },
        total: 3,
      }),
    )
    const { result } = renderHook(() => useAmanat({ fetchImpl, autoStart: true }))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.lanes.active.map((t) => t.id)).toEqual(['good'])
  })

  it('keeps the last board when the office cannot be reached', async () => {
    let fail = false
    const fetchImpl = vi.fn(() =>
      fail
        ? Promise.reject(new Error('offline'))
        : ok({ lanes: { active: [{ id: 'T1', state: 'working', lane: 'active', createdTs: 1, updatedTs: 1 }] }, total: 1 }),
    )
    const { result } = renderHook(() => useAmanat({ fetchImpl, autoStart: true }))
    await waitFor(() => expect(result.current.total).toBe(1))

    fail = true
    await act(async () => {
      await result.current.refresh()
    })
    await waitFor(() => expect(result.current.stale).toBe(true))
    expect(result.current.lanes.active).toHaveLength(1)
  })

  it('does not blank the board on a 401 cold load', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 401 } as Response))
    const { result } = renderHook(() => useAmanat({ fetchImpl, autoStart: true }))
    await waitFor(() => expect(result.current.stale).toBe(true))
    expect(result.current.total).toBe(0)
    expect(result.current.loaded).toBe(false)
  })
})
