/**
 * Babad — the chronicle.
 *
 * The event stream, read as a sect record rather than a console log. Replay is
 * governance: this panel is the product's audit story, so it is a first-class
 * column and not a collapsed drawer.
 *
 * Unknown event types are rendered, not dropped. The contract in docs/EVENTS.md
 * says a client must tolerate them; tolerating is not the same as hiding, and a
 * buyer who sees an event the UI cannot name learns something true about the
 * system.
 */
import React, { useEffect, useRef } from 'react'
import type { HermesEnvelope } from '../hermes/types'

const KIND: Record<string, 'qi' | 'gate' | 'done' | ''> = {
  tool_done: 'done',
  agent_finished: 'done',
  tool_call: 'qi',
  mcp_call: 'qi',
  policy_denied: 'gate',
  approval_required: 'gate',
}

/** Human-sized rendering of one envelope. Never throws on a shape it dislikes. */
function describe(e: HermesEnvelope): { who: string; what: string } {
  const s = (k: string): string => {
    const v = e[k]
    return typeof v === 'string' ? v : ''
  }
  switch (e.type) {
    case 'agent_spawned': {
      const a = (e.agent ?? {}) as { name?: string; role?: string; task?: string }
      return { who: a.name ?? 'agen', what: a.task ?? a.role ?? 'tiba di aula' }
    }
    case 'agent_finished':
      return { who: s('agentId') || 'agen', what: s('summary') || 'selesai berlatih' }
    case 'tool_call':
      return { who: s('agentId') || 'agen', what: `memanggil ${s('tool')} ${s('detail')}`.trim() }
    case 'tool_done':
      return { who: s('agentId') || 'agen', what: `${s('tool')} selesai` }
    case 'mcp_call':
      return { who: s('server') || 'mcp', what: s('tool') }
    case 'git_push': {
      const n = typeof e.commits === 'number' ? e.commits : 0
      return { who: s('author') || s('repo'), what: `${n} commit — ${s('message')}` }
    }
    case 'cron_fired':
      return { who: 'cron', what: s('job') }
    case 'agent_status':
      return { who: s('agent'), what: s('state') }
    case 'service_status':
      return { who: s('host'), what: `${s('unit')} ${s('state')}` }
    case 'channel_msg':
      // The privacy contract: the platform and direction, never the content.
      return { who: s('platform'), what: `${s('channelType')} ${s('direction')}`.trim() }
    default:
      return { who: e.type, what: '' }
  }
}

function hhmm(ts?: number): string {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const Chronicle: React.FC<{ events: HermesEnvelope[] }> = ({ events }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Only follow the tail when the reader is already at the tail. Yanking the
    // scroll out from under someone reading history is how an audit log stops
    // being usable as an audit log.
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atTail) el.scrollTop = el.scrollHeight
  }, [events.length])

  const recent = events.slice(-160)

  return (
    <div className="sect-log" ref={ref}>
      {recent.length === 0 && (
        <p className="sect-log__empty">
          Belum ada catatan.<br />
          <span className="sect-script" style={{ opacity: 0.6 }}>Sunyi</span>
        </p>
      )}
      {recent.map((e, i) => {
        const d = describe(e)
        const kind = KIND[e.type] ?? ''
        return (
          <article key={`${e.ts ?? 0}-${i}`} className={`sect-entry${kind ? ` sect-entry--${kind}` : ''}`}>
            <time className="sect-entry__t">{hhmm(e.ts)}</time>
            <div style={{ minWidth: 0 }}>
              <div className="sect-entry__who">{d.who}</div>
              {d.what && <div className="sect-entry__what">{d.what}</div>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default Chronicle
