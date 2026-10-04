/**
 * Hermes Office — event contract types (docs/EVENTS.md).
 * Client MUST tolerate unknown event types (ignore them).
 */

export type HermesEventSource = 'cloud' | 'mac' | 'github' | 'system'

/** Raw envelope arriving on the WS `event` channel. */
export interface HermesEnvelope {
  type: string
  source?: HermesEventSource
  ts?: number
  [key: string]: unknown
}

export interface AgentPayload {
  name?: string
  role?: string
  task?: string
  id?: string
}

/** Union of the known event types with their typed payloads. */
export type KnownEvent =
  | { type: 'agent_spawned'; agent: AgentPayload }
  | { type: 'agent_finished'; agentId: string; summary?: string }
  | { type: 'tool_call'; agentId?: string; tool: string; detail?: string }
  | { type: 'tool_done'; agentId?: string; tool: string }
  | { type: 'mcp_call'; server: string; tool: string; agentId?: string }
  | { type: 'a2a_task_in'; dest: string; peer?: string; taskId?: string; summary?: string }
  | { type: 'a2a_task_out'; origin: string; peer?: string; state?: string; summary?: string }
  | { type: 'cron_fired'; job: string; dest?: string; ok?: boolean }
  | {
      type: 'git_push'
      repo: string
      privat?: boolean
      author?: string
      commits?: number
      message?: string
      url?: string
      ts?: number
    }
  | { type: 'channel_msg'; platform: string; channelType?: string; direction?: string; agent?: string }
  | { type: 'agent_status'; agent: string; state: 'idle' | 'working' | 'away'; uptimeH?: number; lastSeenTs?: number; metrics?: Record<string, number> }
  | {
      type: 'service_status'
      host: 'cloud' | 'mac'
      unit: string
      kind?: 'systemd' | 'cron' | 'launchd'
      state: 'active' | 'failed' | 'inactive'
      detail?: string
    }

export interface GithubFeedItem {
  id: string
  repo: string
  privat: boolean
  author: string
  commits: number
  message: string
  url?: string
  ts: number
}

/** Server → client WS frames (EVENTS.md §4). */
export type ServerFrame =
  | { channel: 'hello'; data: { server: string; events: string[] } }
  | { channel: 'event'; data: HermesEnvelope }
  | { channel: 'chat_delta'; data: { id?: string; delta: string } }
  | { channel: 'chat_done'; data: { id?: string; text: string } }
  | { channel: 'typing'; data: { who: string } }
  | { channel: 'reaction'; data: { messageId: string; emoji: string } }
  | { channel: 'roster'; data: unknown }
  | { channel: string; data: unknown } // unknown channels tolerated

/** Map agent names (EVENTS.md §2) to internal sprite roles. */
export function agentRoleForName(name?: string): string {
  switch (name) {
    case 'cloud': return 'cloud'
    case 'mac': return 'mac'
    case 'boss': return 'boss'
    case 'cron-runner': return 'cron-runner'
    case 'octo': return 'github'
    case 'guest-ghost': return 'guest-ghost'
    default: break
  }
  if (name?.startsWith('sub:')) return 'code-reviewer'
  if (name?.startsWith('cron:')) return 'cron-runner'
  return 'general-purpose'
}
