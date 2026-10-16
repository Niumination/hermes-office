/**
 * A2A v1.0 lifecycle → office animation.
 *
 * The office used to treat every state except `completed` and `failed` as
 * "still working". A peer that *canceled* a task therefore left its agent
 * animated forever — the UI inventing activity that had stopped, which the
 * product rules forbid outright.
 *
 * These tests lock the three properties that fix depends on. They are written
 * against the exported lifecycle sets rather than a hand-copied list, so
 * widening `A2A_STATES` in server/eventbus.js without teaching the UI about
 * the new state shows up here instead of in production.
 */
import { describe, it, expect } from 'vitest'
import {
  mapHermesEvent,
  TERMINAL_A2A_STATES,
  A2A_WAITING_LABELS,
} from './eventMap'

const out = (state: string, extra: Record<string, unknown> = {}) =>
  mapHermesEvent({
    type: 'a2a_task_out',
    origin: 'cloud',
    state,
    ...extra,
  } as never)

describe('a2a_task_out lifecycle', () => {
  it('treats completed as finished and carries the summary', () => {
    const [ev] = out('completed', { summary: 'repo X: build fixed' })
    expect(ev.type).toBe('agent_completed')
    expect((ev as { result: string }).result).toBe('repo X: build fixed')
  })

  it('stops the animation for every terminal state', () => {
    for (const state of TERMINAL_A2A_STATES) {
      const [ev] = out(state)
      expect(
        ev.type,
        `${state} is terminal — the agent must not keep working`,
      ).toBe('agent_completed')
    }
  })

  it('keeps non-terminal states animated', () => {
    for (const state of ['submitted', 'working', 'input_required', 'auth_required']) {
      const [ev] = out(state)
      expect(ev.type, `${state} is not terminal`).toBe('agent_working')
    }
  })

  it('says plainly when the peer is blocked on a human', () => {
    const [waiting] = out('input_required')
    expect((waiting as { status: string }).status).toBe(
      A2A_WAITING_LABELS.input_required,
    )
    expect((waiting as { status: string }).status).not.toContain('input_required')

    const [auth] = out('auth_required')
    expect((auth as { status: string }).status).toBe(
      A2A_WAITING_LABELS.auth_required,
    )
  })

  it('falls back readably for a state it has never seen', () => {
    const [ev] = out('some_future_state')
    expect(ev.type).toBe('agent_working')
    expect((ev as { status: string }).status).toContain('some_future_state')
  })

  it('defaults a missing state to working rather than dropping the event', () => {
    const [ev] = mapHermesEvent({ type: 'a2a_task_out', origin: 'cloud' } as never)
    expect(ev.type).toBe('agent_working')
  })
})
