/**
 * RoomMiniFeed — DUAL-SPACE-DESIGN M-A fitur #2 (effort S):
 * panel kecil di pojok ruang yang menampilkan 5 event terakhir yang
 * "berasal dari" ruang itu (filter berdasarkan host/room sumber event).
 */
import React from 'react'
import type { HermesEnvelope } from '../hermes/types'
import { eventLine } from '../hermes/ChatPanel'
import type { RoomId } from '../rooms'

/** Which events belong in which room's feed (room → event types). */
const ROOM_EVENT_TYPES: Record<RoomId, string[] | null> = {
  'server-room': ['cron_fired', 'a2a_task_in', 'a2a_task_out', 'tool_call', 'mcp_call', 'agent_status', 'service_status'],
  'mac-studio': ['a2a_task_in', 'a2a_task_out', 'agent_status', 'git_push', 'service_status'],
  'main-office': ['agent_spawned', 'agent_finished', 'git_push', 'channel_msg'],
  // Other rooms have no feed (M-A scope).
  'manager-office': null, 'ceo-office': null, 'meeting-room': null, 'kitchen': null,
  'lobby': null, 'nap-room': null, 'rooftop': null, 'gym': null, 'parking': null,
}

/** Extra filter beyond type: does this event really come from this room? */
function belongsToRoom(env: HermesEnvelope, room: RoomId): boolean {
  const d = env as any
  const types = ROOM_EVENT_TYPES[room]
  if (!types || !types.includes(env.type)) return false
  switch (env.type) {
    case 'service_status':
      return room === 'server-room' ? d.host === 'cloud' : d.host === 'mac'
    case 'agent_status':
      return room === 'server-room' ? d.agent === 'cloud'
        : room === 'mac-studio' ? d.agent === 'mac' : true
    case 'a2a_task_in':
      return room === 'server-room' ? d.dest === 'cloud'
        : room === 'mac-studio' ? d.dest === 'mac' : true
    case 'a2a_task_out':
      return room === 'server-room' ? d.origin === 'cloud'
        : room === 'mac-studio' ? d.origin === 'mac' : true
    case 'cron_fired':
      return room === 'server-room'
    case 'git_push':
      return room === 'mac-studio' || room === 'main-office'
    case 'tool_call':
    case 'mcp_call':
      return room === 'server-room'
    default:
      return true
  }
}

interface Props {
  room: RoomId
  events: HermesEnvelope[]
  /** Max lines shown (design: 5 event terakhir). */
  limit?: number
}

export const RoomMiniFeed: React.FC<Props> = ({ room, events, limit = 5 }) => {
  const lines = events.filter(e => belongsToRoom(e, room)).slice(-limit).reverse()
  if (lines.length === 0) return null
  return (
    <div className="room-mini-feed" data-testid={`mini-feed-${room}`}>
      <div className="room-mini-feed-title">{lines.length ? 'FEED' : ''}</div>
      {lines.map((e, i) => (
        <div key={`${e.ts ?? i}-${i}`} className={`room-mini-feed-line${i === 0 ? ' fresh' : ''}`}>
          {eventLine(e)}
        </div>
      ))}
    </div>
  )
}

export default RoomMiniFeed
