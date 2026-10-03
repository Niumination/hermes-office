/**
 * ChatPanel — chat tab (UI-SPEC.md §5).
 *
 * Sends prompts to the same-origin office-server: POST /chat with
 * { sender, text }. Renders assistant output from WS frames:
 *   chat_delta  → streaming append to the in-progress assistant message
 *   chat_done   → finalize the message
 *   typing      → typing indicator (who)
 *   reaction    → emoji reaction on the last assistant message
 *   event       → office events also surface as system lines
 *
 * Guest mode: read-only — the input is hidden and a notice is shown.
 * Niu-mode `/niu-mode` toggles the theme stub; other `/commands` are sent to
 * the server.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useNiuMode, toggleNiuMode, getStrings } from './niu'
import type { HermesEnvelope } from './types'

export interface ChatLine {
  id: number
  who: string        // 'you' | 'hermes' | 'system'
  text: string
  ts: number
  streaming?: boolean
  reactions?: string[]
}

interface Props {
  lines: ChatLine[]
  typing: string | null
  guest: boolean
  onSend: (text: string) => void
  onReaction: (id: number, emoji: string) => void
}

const REACTIONS = ['👍', '🔥', '🎉', '😂', '🚀']

const ChatPanel: React.FC<Props> = ({ lines, typing, guest, onSend, onReaction }) => {
  const niu = useNiuMode()
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const strings = getStrings()

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, typing])

  const submit = () => {
    const text = input.trim()
    if (!text) return
    if (text === '/niu-mode' || text === '/niu') {
      toggleNiuMode()
      setInput('')
      return
    }
    onSend(text)
    setInput('')
  }

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="chat-header">
        <span className="chat-channel">{strings.chatChannel}</span>
        {niu && <span className="chat-niu-badge">Niu</span>}
        {guest && <span className="chat-guest-badge">guest · read-only</span>}
      </div>

      <div className="chat-body" ref={bodyRef}>
        {lines.length === 0 && (
          <div className="chat-empty">No messages yet. Ask Hermes something…</div>
        )}
        {lines.map(line => (
          <div key={line.id} className={`chat-line chat-${line.who}`}>
            <div className="chat-line-head">
              <span className="chat-who">
                {line.who === 'you' ? 'You' : line.who === 'hermes' ? 'Hermes' : 'system'}
              </span>
              <span className="chat-time">
                {new Date(line.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="chat-text">
              {line.text}
              {line.streaming && <span className="chat-cursor">▋</span>}
            </div>
            {line.reactions && line.reactions.length > 0 && (
              <div className="chat-reactions">
                {line.reactions.map((r, i) => <span key={i} className="chat-reaction">{r}</span>)}
              </div>
            )}
            {line.who === 'hermes' && !line.streaming && line.reactions === undefined && (
              <div className="chat-react-bar">
                {REACTIONS.map(r => (
                  <button key={r} className="chat-react-btn" onClick={() => onReaction(line.id, r)}>{r}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {typing && (
          <div className="chat-line chat-typing">
            <span className="chat-typing-label">{typing} is typing</span>
            <span className="chat-typing-dots"><span /><span /><span /></span>
          </div>
        )}
      </div>

      {!guest && (
        <div className="chat-input-wrap">
          <input
            className="chat-input"
            placeholder={`Message ${strings.chatChannel}`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
          />
          <button className="chat-send" onClick={submit}>Send</button>
        </div>
      )}
    </div>
  )
}

/** Reduce a stream of WS frames + office events into chat lines. */
export function chatLinesFromFrames(
  frames: Array<{ kind: string; data: any; ts: number }>,
  events: HermesEnvelope[],
): ChatLine[] {
  const lines: ChatLine[] = []
  let nextId = 1
  let openAssistant: ChatLine | null = null

  for (const f of frames) {
    if (f.kind === 'chat_delta') {
      if (!openAssistant) {
        openAssistant = { id: nextId++, who: 'hermes', text: '', ts: f.ts, streaming: true }
        lines.push(openAssistant)
      }
      openAssistant.text += String(f.data?.delta ?? '')
    } else if (f.kind === 'chat_done') {
      const text = String(f.data?.text ?? '')
      if (openAssistant) {
        openAssistant.text = text || openAssistant.text
        openAssistant.streaming = false
        openAssistant = null
      } else {
        lines.push({ id: nextId++, who: 'hermes', text, ts: f.ts })
      }
    } else if (f.kind === 'reaction') {
      const target = [...lines].reverse().find(l => l.who === 'hermes')
      if (target) {
        target.reactions = [...(target.reactions ?? []), String(f.data?.emoji ?? '')]
      }
    }
  }

  // Surface office events as compact system lines (keeps the office legible).
  for (const e of events) {
    const ts = Number(e.ts ?? Date.now())
    lines.push({ id: nextId++, who: 'system', text: eventLine(e), ts })
  }

  return lines.slice(-60)
}

export function eventLine(e: HermesEnvelope): string {
  const d = e as any
  switch (e.type) {
    case 'agent_spawned':   return `☁ ${d.agent?.name ?? 'agent'} joined — ${d.agent?.task ?? d.agent?.role ?? ''}`
    case 'agent_finished':  return `✅ ${d.agentId ?? 'agent'} finished${d.summary ? ` — ${d.summary}` : ''}`
    case 'tool_call':       return `⚡ ${d.agentId ?? ''} → ${d.tool ?? 'tool'}${d.detail ? ` (${d.detail})` : ''}`
    case 'mcp_call':        return `🔌 ${d.server ?? 'mcp'} → ${d.tool ?? ''}`
    case 'a2a_task_in':     return `📥 a2a in: ${d.peer ?? '?'} → ${d.dest ?? '?'} — ${d.summary ?? ''}`
    case 'a2a_task_out':    return `📤 a2a out: ${d.origin ?? '?'} → ${d.peer ?? '?'} [${d.state ?? ''}]`
    case 'cron_fired':      return `⏰ cron fired: ${d.job ?? ''}${d.ok === false ? ' (failed)' : ''}`
    case 'git_push':        return `🔄 ${d.repo ?? 'repo'} — ${d.commits ?? 1} commit(s) by ${d.author ?? '?'}`
    case 'channel_msg':     return `💬 ${d.platform ?? ''} ${d.direction ?? ''} via ${d.agent ?? ''}`
    case 'agent_status':    return `❤️ ${d.agent ?? ''} ${d.state ?? ''}`
    default:                return `• ${e.type}`
  }
}

export default ChatPanel
