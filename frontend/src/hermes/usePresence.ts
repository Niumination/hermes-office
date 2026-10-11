/**
 * Presence: who is actually alive, independent of the view that draws them.
 *
 * This logic used to live inside `hermes/OfficeStage.tsx`, the isometric
 * office. The sect interface replaces that view, and a straight replacement
 * would have silently dropped three behaviours the live site depends on:
 *
 *   1. **Seeding.** The WebSocket has no history replay. A viewer who loads
 *      the page sees nothing until the next event arrives — which, for a
 *      quiet fleet, can be minutes. The office looked asleep, and worse, an
 *      agent that went offline an hour ago looked identical to one that never
 *      existed. `GET /presence` is the server's snapshot of that truth.
 *   2. **Polling.** A tab left open overnight drifts: the socket survives,
 *      but an agent that died without a close frame stays "working" forever.
 *      Re-reading the snapshot every 30s bounds that drift.
 *   3. **The watchdog.** The server marks an agent offline after 90s without
 *      a heartbeat. A client that does not mirror the rule shows a different
 *      answer than the API for up to 30s, and the one place that gap is most
 *      visible is the roster a buyer is looking at.
 *
 * Extracting it here is the point: presence is a fact about the fleet, not a
 * property of one renderer. The next view to replace the sect interface gets
 * it for free, which is exactly what did not happen last time.
 */
import { useEffect, useRef, useState } from 'react'

/** Server mirror: `server/presence.js` expires a heartbeat after 90s. */
export const WATCHDOG_MS = 90_000

/** How often the snapshot is re-read. Cheap: one small JSON GET. */
export const PRESENCE_POLL_MS = 30_000

/** How often the local watchdog re-evaluates staleness. */
export const WATCHDOG_TICK_MS = 15_000

export interface PresenceRow {
  online: boolean
  /** Epoch ms of the last heartbeat, when the server knows one. */
  lastSeenTs?: number
}

export type PresenceMap = Record<string, PresenceRow>

interface ServerPresence {
  agents?: Record<string, { online?: boolean; lastSeenTs?: number }>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UsePresenceOptions {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: FetchLike
  /** Heartbeats observed on the socket, by agent id. Keeps the watchdog honest. */
  heartbeats?: Record<string, number>
  pollMs?: number
  tickMs?: number
}

/**
 * Read the fleet's presence and keep it current.
 *
 * Returns a plain map so a caller can merge it with whatever it already
 * tracks. It deliberately does NOT invent agents the server did not name:
 * a UI that renders a row for an agent nobody has heard of is making the
 * same claim as a UI that hides one, only in the other direction.
 */
export function usePresence(opts: UsePresenceOptions = {}): PresenceMap {
  const {
    fetchImpl,
    heartbeats,
    pollMs = PRESENCE_POLL_MS,
    tickMs = WATCHDOG_TICK_MS,
  } = opts

  const [presence, setPresence] = useState<PresenceMap>({})
  const beatsRef = useRef<Record<string, number>>({})
  beatsRef.current = heartbeats ?? beatsRef.current

  // 1 + 2: seed on mount, then re-read on an interval.
  useEffect(() => {
    const doFetch: FetchLike =
      fetchImpl ?? ((i, n) => fetch(i, n))
    let stopped = false

    const load = async () => {
      try {
        const res = await doFetch('/presence', { credentials: 'include' })
        if (!res.ok || stopped) return
        const data = (await res.json()) as ServerPresence
        const agents = data?.agents ?? {}
        const next: PresenceMap = {}
        for (const [id, row] of Object.entries(agents)) {
          next[id] = {
            online: row?.online === true,
            lastSeenTs: typeof row?.lastSeenTs === 'number' ? row.lastSeenTs : undefined,
          }
        }
        if (!stopped) setPresence(next)
      } catch {
        // An unreachable server is not evidence that the fleet is down, so the
        // last known snapshot is kept rather than blanked. Showing "everyone
        // offline" because our own fetch failed would be the UI inventing a
        // claim it cannot support.
      }
    }

    void load()
    const id = setInterval(() => void load(), pollMs)
    return () => { stopped = true; clearInterval(id) }
  }, [fetchImpl, pollMs])

  // 3: local watchdog, mirroring the server's rule.
  useEffect(() => {
    const id = setInterval(() => {
      setPresence((prev) => {
        const now = Date.now()
        let changed = false
        const next: PresenceMap = {}
        for (const [agent, row] of Object.entries(prev)) {
          const last = beatsRef.current[agent] ?? row.lastSeenTs
          const stale = typeof last === 'number' && now - last > WATCHDOG_MS
          if (row.online && stale) {
            next[agent] = { online: false, lastSeenTs: last }
            changed = true
          } else {
            next[agent] = row
          }
        }
        return changed ? next : prev
      })
    }, tickMs)
    return () => clearInterval(id)
  }, [tickMs])

  return presence
}
