/**
 * AgentsPanel — right sidebar roster (UI-SPEC.md §4).
 * Shows fixed cast (cloud, mac, boss, cron-runner, octo) + spawned agents,
 * with status dots and current task. Click a row → detail popup with the
 * agent's last 5 events.
 */
import React, { useState } from 'react'
import type { HermesEnvelope } from './types'
import { agentRoleForName } from './types'

export interface AgentRow {
  id: string
  name: string
  role: string
  state: 'working' | 'idle' | 'away'
  task?: string
  uptimeH?: number
  lastSeenTs?: number
}

const CAST_META: Record<string, { icon: string; label: string }> = {
  'cloud': { icon: '☁️', label: 'Hermes Cloud' },
  'mac': { icon: '💻', label: 'Hermes Mac' },
  'boss': { icon: '👑', label: 'Bos' },
  'cron-runner': { icon: '⏰', label: 'Jalan Cron' },
  'octo': { icon: '🐙', label: 'Octo' },
}

function castName(name: string): string {
  return CAST_META[name]?.label ?? name
}

function castIcon(name: string): string {
  return CAST_META[name]?.icon ?? '👤'
}

export function buildRoster(events: HermesEnvelope[]): AgentRow[] {
  const byId = new Map<string, AgentRow>()

  // Fixed cast: always visible, default states (UI-SPEC.md example shows
  // mac away, boss online, cloud working by default until heartbeats arrive).
  const castDefaults: Record<string, AgentRow['state']> = {
    cloud: 'idle', mac: 'away', boss: 'idle', 'cron-runner': 'idle', octo: 'idle',
  }
  for (const [name, state] of Object.entries(castDefaults)) {
    byId.set(name, {
      id: name, name, role: agentRoleForName(name),
      state, task: undefined,
    })
  }

  for (const e of events) {
    switch (e.type) {
      case 'agent_spawned': {
        const a = (e as any).agent ?? {}
        const name = String(a.name ?? 'agent')
        const existing = byId.get(name)
        byId.set(name, {
          id: a.id ? String(a.id) : name,
          name,
          role: agentRoleForName(name),
          state: existing?.state === 'away' ? 'away' : 'working',
          task: a.task ? String(a.task) : existing?.task,
        })
        break
      }
      case 'agent_finished': {
        const name = String((e as any).agentId ?? '')
        const row = byId.get(name)
        if (row) row.state = 'idle'
        break
      }
      case 'agent_status': {
        const name = String((e as any).agent ?? '')
        const stateRaw = String((e as any).state ?? 'idle')
        const row = byId.get(name) ?? { id: name, name, role: agentRoleForName(name), state: 'idle' as const }
        row.state = stateRaw === 'working' ? 'working' : stateRaw === 'away' ? 'away' : 'idle'
        if (typeof (e as any).uptimeH === 'number') row.uptimeH = (e as any).uptimeH
        row.lastSeenTs = typeof e.ts === 'number' ? e.ts : Date.now()
        byId.set(name, row)
        break
      }
      case 'tool_call': {
        const name = String((e as any).agentId ?? '')
        const row = byId.get(name)
        if (row && !row.task) row.task = String((e as any).tool ?? '')
        if (row) row.state = 'working'
        break
      }
      case 'tool_done': {
        const name = String((e as any).agentId ?? '')
        const row = byId.get(name)
        if (row) { row.state = 'idle'; row.task = undefined }
        break
      }
      default:
        break
    }
  }

  // octo only exists transiently (30s after git_push) — hide unless active
  const octoActive = events.some(e => e.type === 'git_push' && Date.now() - (e.ts ?? 0) < 30_000)
  if (!octoActive) byId.delete('octo')

  return [...byId.values()]
}

interface Props {
  events: HermesEnvelope[]
}

export const AgentsPanel: React.FC<Props> = ({ events }) => {
  const [selected, setSelected] = useState<string | null>(null)
  const roster = buildRoster(events)

  const selectedEvents = selected
    ? events.filter(e => {
        const id = String((e as any).agentId ?? (e as any).agent?.name ?? (e as any).agent ?? '')
        return id === selected
      }).slice(-5).reverse()
    : []

  return (
    <div className="agents-panel" data-testid="agents-panel">
      <div className="agents-panel-title">AGEN</div>
      <div className="agents-list">
        {roster.map(row => (
          <div
            key={row.name}
            className={`agents-row ${selected === row.name ? 'agents-row-selected' : ''}`}
            onClick={() => setSelected(selected === row.name ? null : row.name)}
          >
            <span className="agents-icon">{castIcon(row.name)}</span>
            <span className="agents-name">{castName(row.name)}</span>
            <span className={`agents-dot state-${row.state}`} title={row.state} />
          </div>
        ))}
      </div>
      {selected && (
        <div className="agents-detail" data-testid="agents-detail">
          <div className="agents-detail-title">{castName(selected)}</div>
          <div className="agents-detail-sub">
            status: {roster.find(r => r.name === selected)?.state ?? 'idle'}
            {roster.find(r => r.name === selected)?.uptimeH != null &&
              ` · aktif ${roster.find(r => r.name === selected)!.uptimeH!.toFixed(1)}j`}
          </div>
          <div className="agents-detail-events">
            {selectedEvents.length === 0
              ? <div className="agents-detail-empty">belum ada aktivitas</div>
              : selectedEvents.map((e, i) => (
                  <div key={i} className="agents-detail-event">
                    <span className="agents-detail-type">{e.type}</span>
                    <span className="agents-detail-ts">
                      {e.ts ? new Date(e.ts).toLocaleTimeString() : ''}
                    </span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentsPanel
