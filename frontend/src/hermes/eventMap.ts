/**
 * Hermes event → office animation mapping.
 *
 * Converts Hermes Office envelopes (EVENTS.md) into the internal OfficeEvent
 * shape the ported Claude-office App understands, plus extra behaviours:
 *   - cron_fired      → cron-runner walks to a target desk
 *   - git_push        → octo appears at the GitHub desk for 30s
 *   - a2a_task_*      → agent state animations
 *   - channel_msg     → chatter only (metadata, never content)
 *   - agent_status    → state/heartbeat
 * Unknown event types are ignored gracefully (EVENTS.md §7).
 */
import type { OfficeEvent } from '../types'
import type { HermesEnvelope } from './types'
import { roomRef, type RoomRef } from '../eco/ecosystem'
import { UNMAPPED_ROOM } from '../theme/sect'

export function isKnownEventType(type: string): boolean {
  return KNOWN_TYPES.has(type)
}

/**
 * Where an event puts its agent, as an `office/room` reference.
 *
 * This used to answer with the fork's rooms — mac-studio, server-room,
 * main-office. None of them exist in the owner's ecosystem, so every agent
 * the socket placed landed in a room the office could not draw and was never
 * rendered at all. That was the seam between the two room models, and this
 * function was the whole of it.
 *
 * What an envelope actually tells us is a MACHINE: `mac` or `cloud`. It does
 * not tell us a category of repositories, which is what a room is here. So a
 * machine lands at that machine's ecosystem root, where its main agent sits,
 * and nothing finer is claimed.
 *
 * The exception is a service: 9router, Hermes Gateway, Office Octo and
 * Hermes Cron are all desks in `lightvela/infra` in the ecosystem model, so
 * an event about a service running there can say so without inventing
 * anything.
 *
 * An envelope from neither machine is NOT guessed into a room. It goes to the
 * policy's default, which is the server's word for "governed, placed nowhere".
 */
export function targetRoomFor(env: HermesEnvelope): RoomRef {
  const d = env as any
  // `agent` is a bare string ("mac") OR the object form {name, id, role} that
  // the event contract also allows — the cloud hook sends the object, the mac
  // relay sends the string. Comparing the raw value meant every object-form
  // event resolved to UNMAPPED_ROOM, so the cloud agent was placed correctly
  // by the server and then immediately displaced by its own heartbeat.
  // agentForEnvelope() below already learned this lesson; this function had
  // the same bug and nothing caught it, because both halves have to be wrong
  // the same way before anything visibly breaks.
  const nameOf = (who: unknown): string =>
    typeof who === 'string'
      ? who
      : who && typeof who === 'object'
        ? String((who as { name?: unknown; id?: unknown }).name ??
                 (who as { id?: unknown }).id ?? '')
        : ''
  const machine = (who: unknown): RoomRef => {
    const n = nameOf(who)
    return n === 'mac' ? roomRef('mac', 'root')
      : n === 'cloud' ? roomRef('lightvela', 'root')
      : UNMAPPED_ROOM
  }
  switch (env.type) {
    case 'service_status':
      return d.host === 'mac' ? roomRef('mac', 'root') : roomRef('lightvela', 'infra')
    case 'cron_fired':
      // Hermes Cron is an infra desk: five jobs reporting into topic #55.
      return roomRef('lightvela', 'infra')
    case 'agent_status':
      return machine(d.agent)
    case 'a2a_task_in':
      // a task delivered TO an instance lands at that instance's root
      return machine(d.dest)
    case 'a2a_task_out':
      return machine(d.origin)
    default:
      return machine(env.source)
  }
}

/** Which cast member an event concerns (null = no specific character). */
export function agentForEnvelope(env: HermesEnvelope): string | null {
  const d = env as any
  switch (env.type) {
    case 'agent_status':
    case 'agent_spawned': {
      // `d.agent ?? d.agent?.name` never reached .name — ?? only falls through
      // on null/undefined, so an object agent stringified to "[object Object]".
      const a = d.agent
      if (a == null) return null
      if (typeof a === 'object') return String(a.name ?? a.id ?? '') || null
      return String(a) || null
    }
    case 'agent_finished':
    case 'tool_call':
    case 'tool_done':
    case 'mcp_call':
      return d.agentId ? String(d.agentId) : null
    case 'a2a_task_in':
      return d.dest ? String(d.dest) : null
    case 'a2a_task_out':
      return d.origin ? String(d.origin) : null
    case 'cron_fired':
      return 'cron-runner'
    case 'git_push':
      return 'octo'
    default:
      return null
  }
}

export const KNOWN_TYPES = new Set([
  'agent_spawned', 'agent_finished', 'tool_call', 'tool_done', 'mcp_call',
  'a2a_task_in', 'a2a_task_out', 'cron_fired', 'git_push', 'channel_msg',
  'agent_status', 'service_status',
])

/**
 * A2A v1.0 lifecycle states that end a task. Reaching one of these means the
 * agent stopped, so the office must stop animating it — mirrored from
 * `A2A_STATES` in server/eventbus.js. `completed` is handled separately
 * because it carries the task summary as its result.
 */
export const TERMINAL_A2A_STATES = new Set(['failed', 'canceled', 'rejected'])

/**
 * Plain-language captions for the two states that mean "the peer is blocked on
 * a human". Showing the raw spec token here would make the office look broken
 * at precisely the moment it has something useful to say.
 */
export const A2A_WAITING_LABELS: Record<string, string> = {
  input_required: 'a2a: menunggu jawaban',
  auth_required: 'a2a: menunggu izin',
  submitted: 'a2a: terkirim',
  sent: 'a2a: terkirim',
}

/**
 * Map a Hermes envelope to zero or more internal office events.
 * Returns [] for unknown types (tolerant) and for events with no visual.
 */
export function mapHermesEvent(env: HermesEnvelope): OfficeEvent[] {
  const d = env as any
  switch (env.type) {
    case 'agent_spawned':
      return [{
        type: 'agent_spawned',
        agent: {
          id: String(d.agent?.id ?? d.agent?.name ?? `agent-${Date.now()}`),
          name: String(d.agent?.name ?? 'Agent'),
          role: String(d.agent?.role ?? 'general-purpose'),
          task: d.agent?.task ? String(d.agent.task) : undefined,
        },
      }]

    case 'agent_finished':
      return [{
        type: 'agent_completed',
        agentId: String(d.agentId ?? ''),
        result: d.summary ? String(d.summary) : undefined,
      }]

    case 'tool_call':
      return [{
        type: 'agent_working',
        agentId: d.agentId ? String(d.agentId) : undefined,
        status: d.tool ? String(d.tool) : 'working',
      }]

    case 'tool_done':
      return [{
        type: 'agent_working',
        agentId: d.agentId ? String(d.agentId) : undefined,
        status: 'done',
      }]

    case 'mcp_call':
      return [{
        type: 'mcp_call',
        agentId: d.agentId ? String(d.agentId) : undefined,
        status: `${d.server ?? 'mcp'}.${d.tool ?? ''}`,
      } as any]

    case 'a2a_task_in':
      return [{
        type: 'agent_working',
        agentId: d.dest ? String(d.dest) : undefined,
        status: `a2a: ${d.summary ?? 'task in'}`,
      }]

      case 'a2a_task_out': {
        const origin = d.origin ? String(d.origin) : undefined
        const state = d.state ? String(d.state) : 'working'

        // A2A v1.0 has eight lifecycle states, four of which are terminal. The
        // office used to treat everything except `completed` and `failed` as
        // "still working", so a task the peer had *canceled* kept its agent
        // animated indefinitely — the UI inventing activity that had stopped,
        // which the product rules forbid.
        if (state === 'completed') {
          return [{ type: 'agent_completed', agentId: origin ?? '', result: d.summary ? String(d.summary) : 'a2a done' }]
        }
        if (TERMINAL_A2A_STATES.has(state)) {
          return [{ type: 'agent_completed', agentId: origin ?? '', result: `a2a ${state}` }]
        }
        // Non-terminal. `input_required` / `auth_required` mean the peer has
        // stopped and is waiting on a human — worth saying plainly rather than
        // leaving it as a raw spec token.
        const label = A2A_WAITING_LABELS[state] ?? `a2a: ${state}`
        return [{ type: 'agent_working', agentId: origin, status: label }]
      }

    case 'cron_fired':
      return [{
        type: 'agent_working',
        agentId: 'cron-runner',
        status: `cron: ${d.job ?? ''}${d.ok === false ? ' (failed)' : ''}`,
      }]

    case 'git_push':
      return [{
        type: 'mcp_call',
        agentId: 'octo',
        status: `${d.repo ?? 'repo'} +${d.commits ?? 1}`,
      } as any]

    case 'channel_msg':
      // Metadata only — no content by contract.
      return []

    case 'agent_status':
      return []

    case 'service_status':
      // Consumed by the per-room mini feed + service lamp; no character walk.
      return []

    default:
      // Unknown event type — tolerate & ignore (EVENTS.md §7).
      return []
  }
}
