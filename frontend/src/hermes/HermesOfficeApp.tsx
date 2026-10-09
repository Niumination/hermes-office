/**
 * Hermes Office — top bar with day/night WIB indicator + tabbed side panel
 * (Agents / Chat / GitHub), wrapping the ported office view.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/office.css'
import '../styles/rooms.css'
import '../styles/hermes.css'
// Loaded last: donghua tokens and chrome override the legacy look without
// replacing the layout rules the other three files own.
import '../styles/donghua.css'
import '../styles/sect.css'
import type { HermesEnvelope } from './types'
import { useOfficeSocket } from './useOfficeSocket'
import { startMockFeeder } from './mockFeeder'
import { useNiuMode, toggleNiuMode, getStrings } from './niu'
import { useGuest, setGuest } from './guest'
import { useWibCycle, wibPhaseNow, nightOpacityNow } from './wib'
import AgentsPanel from './AgentsPanel'
import GithubFeed from './GithubFeed'
import ChatPanel, { ChatLine, eventLine } from './ChatPanel'
import OfficeStage from './OfficeStage'
import { isKnownEventType } from './eventMap'

const params = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams()
const isMockMode = params.has('mock')

export const HermesOfficeApp: React.FC = () => {
  const niu = useNiuMode()
  const guest = useGuest()
  const wib = useWibCycle()
  const strings = getStrings()

  const [tab, setTab] = useState<'agents' | 'chat' | 'github'>('agents')
  const [chatLines, setChatLines] = useState<ChatLine[]>([])
  const [typing, setTyping] = useState<string | null>(null)
  const nextChatId = useRef(1)

  // Recent raw envelopes for the panels (dedup key: ts+type).
  const [events, setEvents] = useState<HermesEnvelope[]>([])
  const pushEventRecord = (e: HermesEnvelope) => {
    setEvents(prev => [...prev.slice(-99), e])
  }

  // Track known spawned agents so cron-runner / octo spawn can target them.
  const spawnedRef = useRef<Set<string>>(new Set())

  // Buffer of office events waiting to be applied to OfficeStage.
  const pendingRef = useRef<HermesEnvelope[]>([])
  const [pendingTick, setPendingTick] = useState(0)

  const handleEnvelope = (env: HermesEnvelope) => {
    if (!env || typeof env.type !== 'string') return
    if (!isKnownEventType(env.type)) return // tolerate unknown types
    pushEventRecord(env)
    pendingRef.current.push(env)
    setPendingTick(t => t + 1)
    // Surface office events as compact system lines (UI-SPEC.md §9: all
    // events stay legible in the panel, not just visual).
    setChatLines(prev => [...prev.slice(-59),
      { id: nextChatId.current++, who: 'system' as const, text: eventLine(env), ts: Number(env.ts ?? Date.now()) }])
  }

  // WS client (disabled in mock mode — feeder drives the same pipeline).
  const socket = useOfficeSocket({
    disabled: isMockMode,
    onEvent: handleEnvelope,
    onTyping: d => { setTyping(d?.who ?? null); setTimeout(() => setTyping(null), 8000) },
  })

  // Mock feeder for dev (?mock=1) so the office animates without a server.
  useEffect(() => {
    if (!isMockMode) return
    return startMockFeeder(handleEnvelope)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Day/night: follow WIB cycle (phase snapshot for the stage).
  const [phase, setPhase] = useState(wibPhaseNow())
  useEffect(() => {
    setPhase(wibPhaseNow())
    const id = setInterval(() => setPhase(wibPhaseNow()), 30_000)
    return () => clearInterval(id)
  }, [])

  const nightOpacity = useMemo(() => nightOpacityNow(), [phase])

  const handleSend = (text: string) => {
    setChatLines(prev => [...prev, { id: nextChatId.current++, who: 'you', text, ts: Date.now() }])
    // POST /chat to same-origin office-server (no cross-origin hardcoding).
    fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: 'boss', text }),
    }).catch(() => {})
  }

  const handleReaction = (id: number, emoji: string) => {
    setChatLines(prev => prev.map(l => l.id === id
      ? { ...l, reactions: [...(l.reactions ?? []), emoji] }
      : l))
  }

  const drainPending = () => {
    const buf = pendingRef.current
    pendingRef.current = []
    return buf
  }

  return (
    <div className={`hermes-shell${niu ? ' niu' : ''}`} data-testid="hermes-office">
      <div className="hermes-topbar">
        <span className="hermes-brand">{niu ? 'Kantor Niu 🏢' : '🏢 Hermes Office'}</span>
        <span className="hermes-wib" data-testid="wib-indicator">
          {wib.phase === 'day' ? '☀️' : '🌙'} {wib.label}
        </span>
        <span className="hermes-conn" data-testid="conn-status">
          {isMockMode ? '● mock feed' : socket.connected ? '● live' : socket.offline ? '○ offline' : '…'}
        </span>
        <button className="hermes-tab-btn" onClick={() => setGuest(!guest)}>
          {guest ? '🔒 guest' : '🔓 boss'}
        </button>
        <button
          className="hermes-tab-btn"
          onClick={() => toggleNiuMode()}
          title="Niu-mode theme"
        >
          {niu ? '🍈 niu: on' : '🍈 niu: off'}
        </button>
      </div>

      <div className="hermes-body">
        <div className="hermes-office-col">
          <OfficeStage
            phase={phase}
            nightOpacity={nightOpacity}
            drainPending={drainPending}
            pendingTick={pendingTick}
            spawnedRef={spawnedRef}
          />
        </div>

        <div className="hermes-side">
          <div className="hermes-tabs">
            <button
              className={`hermes-tab${tab === 'agents' ? ' active' : ''}`}
              onClick={() => setTab('agents')}
            >Agents</button>
            <button
              className={`hermes-tab${tab === 'chat' ? ' active' : ''}`}
              onClick={() => setTab('chat')}
            >Chat</button>
            <button
              className={`hermes-tab${tab === 'github' ? ' active' : ''}`}
              onClick={() => setTab('github')}
            >GitHub</button>
          </div>

          <div className="hermes-panel-area">
            {tab === 'agents' && <AgentsPanel events={events} />}
            {tab === 'chat' && (
              <ChatPanel
                lines={chatLines}
                typing={typing}
                guest={guest}
                onSend={handleSend}
                onReaction={handleReaction}
              />
            )}
            {tab === 'github' && <GithubFeed events={events} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default HermesOfficeApp
