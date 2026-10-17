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
  targetRoomFor,
  TERMINAL_A2A_STATES,
  A2A_WAITING_LABELS,
} from './eventMap'
import { roomByRef } from '../eco/ecosystem'

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

/**
 * Where an event puts its agent.
 *
 * This answered with the fork's rooms until 2026-10-17 — mac-studio,
 * server-room, main-office. The office draws the owner's ecosystem, so every
 * agent the socket placed landed somewhere undrawable and was never rendered.
 * The court looked empty while the socket was busy. These tests fail if any
 * of that vocabulary comes back.
 */
describe('targetRoomFor', () => {
  const env = (o: Record<string, unknown>) => o as never

  it('never answers with a room the ecosystem cannot draw', () => {
    const samples = [
      env({ type: 'service_status', host: 'mac' }),
      env({ type: 'service_status', host: 'cloud' }),
      env({ type: 'cron_fired' }),
      env({ type: 'agent_status', agent: 'mac' }),
      env({ type: 'agent_status', agent: 'cloud' }),
      env({ type: 'a2a_task_in', dest: 'mac' }),
      env({ type: 'a2a_task_out', origin: 'cloud' }),
      env({ type: 'tool_call', source: 'mac' }),
    ]
    for (const e of samples) {
      const ref = targetRoomFor(e)
      expect(roomByRef(ref), `${JSON.stringify(e)} -> ${ref}`).toBeDefined()
    }
  })

  it('puts a machine at its own ecosystem root, not the other one', () => {
    expect(targetRoomFor(env({ type: 'agent_status', agent: 'mac' }))).toBe('mac/root')
    expect(targetRoomFor(env({ type: 'agent_status', agent: 'cloud' }))).toBe('lightvela/root')
  })

  it('sends service and cron traffic to the room those desks are in', () => {
    // 9router, Hermes Gateway, Office Octo and Hermes Cron are all
    // lightvela/infra desks in the ecosystem model.
    expect(targetRoomFor(env({ type: 'cron_fired' }))).toBe('lightvela/infra')
    expect(targetRoomFor(env({ type: 'service_status', host: 'cloud' }))).toBe('lightvela/infra')
  })

  it('refuses to guess a room for an unknown machine', () => {
    // An envelope names a machine, never a category of repositories. When it
    // names neither machine there is nothing to infer, and the honest answer
    // is the policy default rather than a room picked for looks.
    for (const e of [
      env({ type: 'agent_status', agent: 'someone-else' }),
      env({ type: 'tool_call', source: 'unknown-host' }),
      env({ type: 'a2a_task_in', dest: undefined }),
    ]) {
      expect(targetRoomFor(e)).toBe('belum-dipetakan')
      expect(roomByRef(targetRoomFor(e))).toBeUndefined()
    }
  })
})
