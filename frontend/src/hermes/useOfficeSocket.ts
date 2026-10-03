/**
 * useOfficeSocket — Hermes Office WebSocket client.
 *
 * Connects to the same-origin office-server WS (`<scheme>://<host>/ws` unless
 * overridden). Features:
 *   - `hello` handshake handling (records server version + supported types)
 *   - auto-reconnect with exponential back-off (capped at 30s)
 *   - tolerant of unknown channels / unknown event types (ignored, kept in log)
 *   - exposes recent events so a dev mock feeder can drive the same pipeline
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HermesEnvelope, ServerFrame } from './types'

const BACKOFF_INITIAL = 500
const BACKOFF_MAX = 30_000
const BACKOFF_FACTOR = 2
const MAX_EVENTS = 100

/** Same-origin WS URL (respects path prefix on subdomain & path deploys). */
export function defaultWsUrl(): string {
  if (typeof window === 'undefined') return '/ws'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export interface OfficeSocketOptions {
  url?: string
  /** Disable connection entirely (mock mode). */
  disabled?: boolean
  /** Called for every `event` channel frame. Stable ref recommended. */
  onEvent?: (e: HermesEnvelope) => void
  onChatDelta?: (d: { id?: string; delta: string }) => void
  onChatDone?: (d: { id?: string; text: string }) => void
  onTyping?: (d: { who: string }) => void
  onReaction?: (d: { messageId: string; emoji: string }) => void
  onRoster?: (d: unknown) => void
}

export interface OfficeSocketResult {
  connected: boolean
  /** True if the server has never been reachable since mount. */
  offline: boolean
  /** Server version from the `hello` handshake, if received. */
  serverVersion: string | null
  /** Event types the server advertised in `hello`. */
  supportedTypes: string[]
  /** Recent event envelopes (capped). */
  events: HermesEnvelope[]
  /** Dev helper: push a synthetic event through the same handlers. */
  inject: (e: HermesEnvelope) => void
}

export function useOfficeSocket(options: OfficeSocketOptions = {}): OfficeSocketResult {
  const {
    url = defaultWsUrl(),
    disabled = false,
    onEvent, onChatDelta, onChatDone, onTyping, onReaction, onRoster,
  } = options

  const [connected, setConnected] = useState(false)
  const [offline, setOffline] = useState(false)
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const [supportedTypes, setSupportedTypes] = useState<string[]>([])
  const [events, setEvents] = useState<HermesEnvelope[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  // Keep callbacks in refs so the socket effect never needs to re-run.
  const cbs = useRef({ onEvent, onChatDelta, onChatDone, onTyping, onReaction, onRoster })
  useEffect(() => {
    cbs.current = { onEvent, onChatDelta, onChatDone, onTyping, onReaction, onRoster }
  }, [onEvent, onChatDelta, onChatDone, onTyping, onReaction, onRoster])

  const pushEvent = useCallback((e: HermesEnvelope) => {
    setEvents(prev => [...prev.slice(-(MAX_EVENTS - 1)), e])
    cbs.current.onEvent?.(e)
  }, [])

  const handleFrame = useCallback((raw: string) => {
    let frame: ServerFrame
    try { frame = JSON.parse(raw) } catch { return }

    switch (frame.channel) {
      case 'hello': {
        const d = frame.data as { server?: string; events?: string[] }
        if (d?.server) setServerVersion(d.server)
        if (Array.isArray(d?.events)) setSupportedTypes(d.events)
        return
      }
      case 'event':
        pushEvent(frame.data as HermesEnvelope)
        return
      case 'chat_delta':
        cbs.current.onChatDelta?.(frame.data as { id?: string; delta: string })
        return
      case 'chat_done':
        cbs.current.onChatDone?.(frame.data as { id?: string; text: string })
        return
      case 'typing':
        cbs.current.onTyping?.(frame.data as { who: string })
        return
      case 'reaction':
        cbs.current.onReaction?.(frame.data as { messageId: string; emoji: string })
        return
      case 'roster':
        cbs.current.onRoster?.(frame.data)
        return
      default:
        // Unknown channel — tolerate (EVENTS.md §7).
        return
    }
  }, [pushEvent])

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || disabled) return
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    const delay = Math.min(BACKOFF_INITIAL * Math.pow(BACKOFF_FACTOR, retryCountRef.current), BACKOFF_MAX)
    retryCountRef.current += 1
    retryTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !disabled) connect()
    }, delay)
  }, [disabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    if (!mountedRef.current || disabled) return
    if (wsRef.current) {
      wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onclose = wsRef.current.onerror = null
      try { wsRef.current.close() } catch { /* ignore */ }
      wsRef.current = null
    }

    let ws: WebSocket
    try { ws = new WebSocket(url) } catch { scheduleReconnect(); return }
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      retryCountRef.current = 0
      setConnected(true)
      setOffline(false)
    }
    ws.onmessage = (evt) => { if (mountedRef.current) handleFrame(String(evt.data)) }
    ws.onclose = () => {
      if (!mountedRef.current) return
      setConnected(false)
      scheduleReconnect()
    }
    ws.onerror = () => { if (retryCountRef.current === 0) setOffline(true) }
  }, [url, disabled, handleFrame, scheduleReconnect])

  useEffect(() => {
    mountedRef.current = true
    if (!disabled) connect()
    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
      if (wsRef.current) {
        wsRef.current.onopen = wsRef.current.onmessage = wsRef.current.onclose = wsRef.current.onerror = null
        try { wsRef.current.close() } catch { /* ignore */ }
        wsRef.current = null
      }
    }
  }, [disabled, connect])

  const inject = useCallback((e: HermesEnvelope) => pushEvent(e), [pushEvent])

  return { connected, offline, serverVersion, supportedTypes, events, inject }
}
