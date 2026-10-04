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
import type { RoomId } from '../rooms'

export function isKnownEventType(type: string): boolean {
  return KNOWN_TYPES.has(type)
}

/** Default room per event source/agent (DUAL-SPACE-DESIGN M-A §5.2). */
export function targetRoomFor(env: HermesEnvelope): RoomId {
  const d = env as any
  switch (env.type) {
    case 'service_status':
      return d.host === 'mac' ? 'mac-studio' : 'server-room'
    case 'cron_fired':
      return 'server-room'
    case 'agent_status':
      return d.agent === 'mac' ? 'mac-studio' : d.agent === 'cloud' ? 'server-room' : 'main-office'
    case 'a2a_task_in':
      // a task delivered TO an instance lands in that instance's room
      return d.dest === 'mac' ? 'mac-studio' : d.dest === 'cloud' ? 'server-room' : 'main-office'
    case 'a2a_task_out':
      return d.origin === 'mac' ? 'mac-studio' : d.origin === 'cloud' ? 'server-room' : 'main-office'
    default:
      return env.source === 'mac' ? 'mac-studio'
        : env.source === 'cloud' ? 'server-room'
        : 'main-office'
  }
}

/** Which cast member an event concerns (null = no specific character). */
export function agentForEnvelope(env: HermesEnvelope): string | null {
  const d = env as any
  switch (env.type) {
    case 'agent_status':
    case 'agent_spawned':
      return String(d.agent ?? d.agent?.name ?? '') || null
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
      if (d.state === 'completed') {
        return [{ type: 'agent_completed', agentId: origin ?? '', result: d.summary ? String(d.summary) : 'a2a done' }]
      }
      if (d.state === 'failed') {
        return [{ type: 'agent_working', agentId: origin, status: 'a2a failed' }]
      }
      return [{ type: 'agent_working', agentId: origin, status: `a2a: ${d.state ?? 'working'}` }]
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
