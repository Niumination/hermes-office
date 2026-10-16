/**
 * Sabda — the operator's exchange with the office, as state.
 *
 * This is the surface the sect interface was shipped without. `server/chat.js`
 * and `server/chat-db.js` are live, persistent and reachable, and nothing in
 * the UI spoke to them: a whole feature with no door.
 *
 * It is deliberately NOT the Babad. The chronicle is what the fleet did; this
 * is what was said to it. Keeping them in one list would make a spoken
 * instruction look like an executed one, which is the same class of lie this
 * repo refuses everywhere else.
 *
 * ## The permission boundary is the server's, and it is mirrored, not invented
 *
 *   GET  /chat         requireAny(bridge, owner)
 *   POST /chat         requireAuth(bridge, owner)
 *   POST /chat/react   requireAny(bridge, owner)
 *   POST /chat/typing  requireAny
 *
 * All three need a session, so signed out there is nothing to show. The UI
 * hides the composer because the server would refuse it — not to be decorative
 * about it. When the server refuses anyway (403), the refusal is shown as the
 * server's, verbatim in effect, rather than swallowed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SabdaMessageLike } from '../hermes/useOfficeSocket'

export interface SabdaMessage {
  id: number | string
  sender: string
  role?: string
  text: string
  timestamp: number
  system: boolean
  reactions: string[]
  /** True while chat_delta frames are still arriving for this line. */
  streaming?: boolean
}

/** Typing indicators are noise after a while; the server never clears them. */
export const TYPING_CLEAR_MS = 8_000

/** Capped backoff for the cold-load session race. Mirrors BACKOFF_MAX = 30s. */
export const HISTORY_RETRY_DELAYS = [400, 900, 2_000, 4_000, 8_000, 16_000, 30_000]

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UseSabdaOptions {
  /** Injected in tests. */
  fetchImpl?: FetchLike
  /** Who the composer speaks as. */
  sender?: string
  typingClearMs?: number
}

export interface SabdaState {
  messages: SabdaMessage[]
  typing: string | null
  /** Set when the server refused something. Shown as the server's word. */
  refusal: string | null
  loaded: boolean
  send: (text: string) => Promise<void>
  react: (id: number | string, emoji: string) => Promise<void>
  // Handlers to hand straight to useOfficeSocket.
  onChatDelta: (d: { sender?: string; delta: string }) => void
  onChatDone: (d: SabdaMessageLike) => void
  onTyping: (d: { sender: string }) => void
  onReaction: (d: { messageId: number | string; reactions: string[] }) => void
}

/**
 * The server is asymmetric about reactions, and both halves are load-bearing:
 *
 *   GET /chat        returns the raw SQLite row, where `reactions` is a TEXT
 *                    column holding JSON — a *string* like '["\u{1F44D}"]'.
 *   WS reaction      broadcasts the already-parsed *array* (chat.js:95).
 *
 * Accepting only the array would silently drop every reaction that existed
 * before the page loaded. The server is the contract, so the client absorbs
 * the asymmetry rather than the server being bent to suit it.
 */
function toReactions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((r): r is string => typeof r === 'string')
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : []
    } catch { return [] }
  }
  return []
}

function normalise(row: SabdaMessageLike): SabdaMessage {
  return {
    id: row.id,
    sender: row.sender,
    role: row.role,
    text: row.text ?? '',
    timestamp: row.timestamp ?? Date.now(),
    system: row.is_system === 1,
    reactions: toReactions(row.reactions),
  }
}

export function useSabda(opts: UseSabdaOptions = {}): SabdaState {
  const { fetchImpl, sender = 'owner', typingClearMs = TYPING_CLEAR_MS } = opts
  const doFetch: FetchLike = fetchImpl ?? ((i, n) => fetch(i, n))

  const [messages, setMessages] = useState<SabdaMessage[]>([])
  const [typing, setTyping] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // History. The retry is not defensive padding: on a cold load this used to
  // race the auto-guest session mint and lose, leaving the transcript empty
  // until the visitor happened to reload. Observed in a real browser, not
  // theorised. The race is gone with the auto-session, but a 401 still means
  // "no session yet" during the moment between the owner submitting their
  // token and the cookie landing, so the capped backoff stays.
  useEffect(() => {
    let stopped = false
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    void (async () => {
      for (let attempt = 0; !stopped; attempt++) {
        try {
          const res = await doFetch('/chat?limit=50', { credentials: 'include' })
          if (stopped) return
          if (res.status === 401 && attempt < HISTORY_RETRY_DELAYS.length) {
            await sleep(HISTORY_RETRY_DELAYS[attempt])
            continue
          }
          if (res.ok) {
            const data = (await res.json()) as { messages?: SabdaMessageLike[] }
            if (stopped) return
            setMessages((data?.messages ?? []).map(normalise))
          }
        } catch {
          // Unreachable server: an empty transcript is honest here, because we
          // genuinely do not know of any messages.
        }
        if (!stopped) setLoaded(true)
        return
      }
    })()

    return () => { stopped = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current) }, [])

  const onChatDelta = useCallback((d: { sender?: string; delta: string }) => {
    if (!d?.delta) return
    const who = d.sender ?? 'hermes'
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.streaming && last.sender === who) {
        const next = prev.slice(0, -1)
        next.push({ ...last, text: last.text + d.delta })
        return next
      }
      return [...prev, {
        id: `streaming:${who}`, sender: who, text: d.delta,
        timestamp: Date.now(), system: false, reactions: [], streaming: true,
      }]
    })
  }, [])

  const onChatDone = useCallback((row: SabdaMessageLike) => {
    if (!row) return
    const done = normalise(row)
    setMessages((prev) => {
      // Replace the streaming placeholder this completes, if there is one.
      const i = prev.findIndex((m) => m.streaming && m.sender === done.sender)
      if (i >= 0) { const n = prev.slice(); n[i] = done; return n }
      // Idempotent: the server may replay a message we already hold.
      if (prev.some((m) => m.id === done.id)) return prev
      return [...prev, done]
    })
  }, [])

  const onTyping = useCallback((d: { sender: string }) => {
    if (!d?.sender) return
    setTyping(d.sender)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setTyping(null), typingClearMs)
  }, [typingClearMs])

  const onReaction = useCallback((d: { messageId: number | string; reactions: string[] }) => {
    if (!d) return
    setMessages((prev) => prev.map((m) =>
      String(m.id) === String(d.messageId) ? { ...m, reactions: toReactions(d.reactions) } : m))
  }, [])

  const send = useCallback(async (text: string) => {
    const body = text.trim()
    if (!body) return
    setRefusal(null)
    try {
      const res = await doFetch('/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, text: body }),
      })
      if (res.status === 401 || res.status === 403) {
        // The server said no. Say so, rather than dropping the message and
        // letting the operator think it was delivered.
        setRefusal('Perguruan menolak sabda ini — kedudukan Anda tidak mencukupi.')
        return
      }
      if (!res.ok) { setRefusal(`Sabda tidak tersampaikan (${res.status}).`); return }
      // The accepted message arrives back over the socket as chat_done, so it
      // is not appended here. Appending would double it on every send.
    } catch {
      setRefusal('Sabda tidak tersampaikan — perguruan tidak terjangkau.')
    }
  }, [doFetch, sender])

  const react = useCallback(async (id: number | string, emoji: string) => {
    try {
      await doFetch('/chat/react', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: id, emoji }),
      })
      // The authoritative reaction list comes back on the `reaction` frame.
    } catch { /* offline — the socket will correct us when it returns */ }
  }, [doFetch])

  return { messages, typing, refusal, loaded, send, react, onChatDelta, onChatDone, onTyping, onReaction }
}
