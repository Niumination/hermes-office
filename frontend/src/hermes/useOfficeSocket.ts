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
  /**
   * Frame shapes below are the SERVER's, read from server/chat.js — not a
   * guess. They used to be wrong in a way no test could see, because every
   * one of these is a bare `as` cast with no runtime check:
   *
   *   typing   server sends { sender }        — this said { who }
   *   reaction server sends { messageId, reactions: string[] } — said { emoji }
   *
   * The old office read `d?.who` on every typing frame, which is permanently
   * undefined, so the typing indicator never once appeared in production.
   * A cast is a promise the compiler cannot keep; the only thing that makes
   * it true is matching it to the sender.
   */
  onChatDelta?: (d: { sender?: string; delta: string }) => void
  onChatDone?: (d: SabdaMessageLike) => void
  onTyping?: (d: { sender: string }) => void
  onReaction?: (d: { messageId: number | string; reactions: string[] }) => void
  onRoster?: (d: unknown) => void
}

/** One row of `messages` in server/chat-db.js, as the server serialises it. */
export interface SabdaMessageLike {
  id: number
  sender: string
  role?: string
  text: string
  timestamp: number
  is_system?: number
  /** TEXT JSON from GET /chat; a real array on the WS frame. Both occur. */
  reactions?: string[] | string
}

/**
 * Channels that only ever reach a client through server/chat.js.
 *
 * `server/index.js` has one `broadcast()` and it hardcodes the envelope:
 *
 *     const raw = JSON.stringify({ channel: "event", data: event })
 *
 * chat.js then calls that same function with an envelope of its own —
 * `broadcast({ channel: "chat_done", data: msg })` — so what actually goes
 * down the wire is a frame inside a frame:
 *
 *     {"channel":"event","data":{"channel":"typing","data":{"sender":"hermes"}}}
 *
 * Captured from a live socket, not inferred. Two consequences, both real
 * today: `case 'chat_done'` can never fire, so every chat frame is dropped;
 * and the nested envelope is handed to onEvent as though it were an
 * event, so the chronicle quietly logs rows for things that are not events.
 *
 * The server is the contract and is not edited to suit the client, so the
 * client unwraps. The guard is deliberately narrow — a `channel_msg` event
 * also carries a `channel` field (the platform name), and unwrapping on that
 * would eat real events.
 */
const WRAPPED_CHANNELS = new Set(['chat_done', 'chat_delta', 'typing', 'reaction', 'roster'])

export function unwrapFrame(frame: ServerFrame): ServerFrame {
  if (frame?.channel !== 'event') return frame
  const inner = frame.data as { channel?: unknown; data?: unknown } | null
  if (
    inner && typeof inner === 'object' &&
    typeof inner.channel === 'string' &&
    WRAPPED_CHANNELS.has(inner.channel) &&
    'data' in inner
  ) {
    return inner as ServerFrame
  }
  return frame
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
    frame = unwrapFrame(frame)

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
        cbs.current.onChatDelta?.(frame.data as { sender?: string; delta: string })
        return
      case 'chat_done':
        cbs.current.onChatDone?.(frame.data as SabdaMessageLike)
        return
      case 'typing':
        cbs.current.onTyping?.(frame.data as { sender: string })
        return
      case 'reaction':
        cbs.current.onReaction?.(frame.data as { messageId: number | string; reactions: string[] })
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
