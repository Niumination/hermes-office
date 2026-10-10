/**
 * HermesOfficeApp — akar aplikasi.
 *
 * TAMPILAN: tata letak sektalar proto/office-sect.html (SectShell), bahasa
 * Indonesia. Lapisan data di bawahnya tidak berubah: WS /presence, mock
 * feeder, siklus WIB, dan chat tetap pakai mekanisme yang sama.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/office.css'
import '../styles/rooms.css'
import '../styles/hermes.css'
import '../styles/donghua.css'
import '../styles/sect.css'
import '../styles/sect-proto.css'
import SectShell from '../components/SectShell'
import { useOfficeSocket } from './useOfficeSocket'
import { startMockFeeder } from './mockFeeder'
import { useGuest, setGuest } from './guest'
import ChatPanel, { type ChatLine, eventLine } from './ChatPanel'
import { isKnownEventType } from './eventMap'
import { applyTheme } from '../theme/themeStore'
import type { HermesEnvelope } from './types'

const params = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams()
const isMockMode = params.has('mock')

export const HermesOfficeApp: React.FC = () => {
  const guest = useGuest()

  const [chatLines, setChatLines] = useState<ChatLine[]>([])
  const nextChatId = useRef(1)

  const [events, setEvents] = useState<HermesEnvelope[]>([])
  const pushEventRecord = (e: HermesEnvelope) => {
    setEvents(prev => [...prev.slice(-99), e])
  }

  const spawnedRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<HermesEnvelope[]>([])
  const [pendingTick, setPendingTick] = useState(0)

  const handleEnvelope = (env: HermesEnvelope) => {
    if (!env || typeof env.type !== 'string') return
    if (!isKnownEventType(env.type)) return
    pushEventRecord(env)
    pendingRef.current.push(env)
    setPendingTick(t => t + 1)
    setChatLines(prev => [...prev.slice(-59),
      { id: nextChatId.current++, who: 'system' as const,
        text: eventLine(env), ts: Number(env.ts ?? Date.now()) }])
  }

  const socket = useOfficeSocket({
    disabled: isMockMode,
    onEvent: handleEnvelope,
    onTyping: () => {},
  })

  useEffect(() => {
    if (!isMockMode) return
    return startMockFeeder(handleEnvelope)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Agen online dari /presence, untuk meredupkan yang offline di aula.
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch('/presence')
        if (!r.ok || stop) return
        const data = await r.json()
        const ids = new Set<string>()
        for (const [id, p] of Object.entries(data?.agents ?? {})) {
          if ((p as any)?.online) ids.add(id)
        }
        setOnlineIds(ids)
      } catch { /* server offline — abaikan */ }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  useEffect(() => { applyTheme() }, [])

  return (
    <div data-testid="hermes-office">
      <SectShell
        mock={isMockMode}
        connected={socket.connected}
        guest={guest}
        onlineIds={onlineIds}
      />
    </div>
  )
}

export default HermesOfficeApp
