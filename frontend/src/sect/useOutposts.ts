/**
 * Pos Jaga — outposts the sect watches but does not run.
 *
 * Polled, not socketed, and deliberately so: `GET /desks` returns a snapshot
 * the server already has (it probes on its own interval), so a poll is cheap
 * and a dropped socket cannot leave this panel silently frozen on stale data.
 * Same shape as usePresence, which solved the same problem.
 *
 * The one rule this hook exists to enforce: when we cannot reach the office,
 * we keep showing the last snapshot and say when it was taken — we do not
 * blank the board, and we do not turn everything red. "I don't know" is a
 * state the server already models (`unknown`); the client must not quietly
 * upgrade it to "broken".
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type OutpostState = 'ok' | 'failed' | 'stale' | 'unknown'

export interface Outpost {
  id: string
  label: string
  hall: string | null
  note?: string | null
  kind: 'http' | 'file'
  state: OutpostState
  lastTs: number | null
  checkedTs: number | null
  detail?: string | null
  redacted?: boolean
}

export const OUTPOST_POLL_MS = 30_000
const BACKOFF_MAX_MS = 30_000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UseOutpostsOptions {
  fetchImpl?: FetchLike
  pollMs?: number
  /** Tests drive this manually; production uses the real timer. */
  autoStart?: boolean
}

export interface OutpostsState {
  outposts: Outpost[]
  /** Owner-only config complaints, e.g. a typo in desks.json. */
  problems: string[]
  /** null until the first answer — distinct from "answered with none". */
  lastOkTs: number | null
  loaded: boolean
  /** True when the last attempt failed; the list shown is the previous one. */
  stale: boolean
  refresh: () => Promise<void>
}

const VALID: OutpostState[] = ['ok', 'failed', 'stale', 'unknown']

function normalise(raw: unknown): Outpost | null {
  const d = raw as Partial<Outpost> | null
  if (!d || typeof d.id !== 'string') return null
  // An unrecognised state becomes `unknown`, never `ok`. Guessing in the
  // optimistic direction is how a monitor lies.
  const state = VALID.includes(d.state as OutpostState) ? (d.state as OutpostState) : 'unknown'
  return {
    id: d.id,
    label: typeof d.label === 'string' && d.label ? d.label : d.id,
    hall: typeof d.hall === 'string' ? d.hall : null,
    note: typeof d.note === 'string' ? d.note : null,
    kind: d.kind === 'file' ? 'file' : 'http',
    state,
    lastTs: typeof d.lastTs === 'number' ? d.lastTs : null,
    checkedTs: typeof d.checkedTs === 'number' ? d.checkedTs : null,
    detail: typeof d.detail === 'string' ? d.detail : null,
    redacted: d.redacted === true,
  }
}

export function useOutposts(opts: UseOutpostsOptions = {}): OutpostsState {
  const { fetchImpl, pollMs = OUTPOST_POLL_MS, autoStart = true } = opts
  const doFetch: FetchLike = fetchImpl ?? ((i, n) => fetch(i, n))

  const [outposts, setOutposts] = useState<Outpost[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [lastOkTs, setLastOkTs] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [stale, setStale] = useState(false)
  const failures = useRef(0)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await doFetch('/desks', { credentials: 'include' })
      if (!alive.current) return
      if (!res.ok) {
        // 401 on a cold load means the guest session has not been minted yet
        // (SectApp touches /kiosk for that), not that we are forbidden.
        failures.current += 1
        setStale(true)
        return
      }
      const data = (await res.json()) as { desks?: unknown[]; problems?: unknown[] }
      if (!alive.current) return
      setOutposts((data?.desks ?? []).map(normalise).filter((d): d is Outpost => d !== null))
      setProblems(Array.isArray(data?.problems)
        ? data.problems.filter((p): p is string => typeof p === 'string')
        : [])
      setLastOkTs(Date.now())
      setStale(false)
      failures.current = 0
    } catch {
      // Keep the previous snapshot. Blanking the board on a flaky network
      // would claim the outposts vanished, which is not what happened.
      failures.current += 1
      if (alive.current) setStale(true)
    } finally {
      if (alive.current) setLoaded(true)
    }
  }, [doFetch])

  useEffect(() => {
    alive.current = true
    if (!autoStart) return () => { alive.current = false }

    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      void refresh().finally(() => {
        if (!alive.current) return
        const delay = failures.current > 3
          ? Math.min(pollMs * 10, BACKOFF_MAX_MS)
          : pollMs
        timer = setTimeout(tick, delay)
      })
    }
    tick()

    return () => {
      alive.current = false
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, autoStart])

  return { outposts, problems, lastOkTs, loaded, stale, refresh }
}
