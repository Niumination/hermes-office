/**
 * Amanat — what the fleet is working on.
 *
 * The office has always been able to say *who is where*. It has never been
 * able to say *what they are doing*. This hook reads the board the server
 * folds out of the ledger (`server/tasks.js`) so the panel and the chain can
 * never disagree about what was running.
 *
 * Polled rather than folded client-side, for the same reason as useOutposts:
 * the server already holds the authoritative projection, so a poll is cheap
 * and a dropped socket cannot leave the panel frozen on a stale board while
 * looking live. Folding the event stream a second time in the browser would
 * mean two implementations of the lifecycle rules that are free to drift.
 *
 * The rule this hook exists to enforce: when the office cannot be reached we
 * keep the last board and mark it stale. We never blank it, and we never
 * invent a task. An empty board must mean "nothing is running", not "the
 * fetch failed" — otherwise the one question this panel answers becomes
 * untrustworthy exactly when something is wrong.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'auth_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

export type LaneId = 'blocked' | 'active' | 'queued' | 'done' | 'stopped'

export interface Amanat {
  id: string
  state: TaskState
  lane: LaneId
  agent: string | null
  origin: string | null
  title: string | null
  repo: string | null
  peer?: string | null
  createdTs: number
  updatedTs: number
  blocked: boolean
  redacted?: boolean
}

export interface AmanatBoard {
  lanes: Record<LaneId, Amanat[]>
  order: LaneId[]
  counts: Record<LaneId, number>
  total: number
  blocked: number
  redacted: boolean
}

export interface AmanatState extends AmanatBoard {
  loaded: boolean
  stale: boolean
  lastOkTs: number | null
  refresh: () => Promise<void>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UseAmanatOptions {
  fetchImpl?: FetchLike
  pollMs?: number
  autoStart?: boolean
  /**
   * Bump this to force an immediate refetch. SectApp passes a counter it
   * increments when a task-bearing event arrives on the socket, which is what
   * makes the board feel live without a second wire format for task state.
   */
  nudge?: number
}

export const AMANAT_POLL_MS = 15_000

const LANE_ORDER: LaneId[] = ['blocked', 'active', 'queued', 'done', 'stopped']

/** Captions. `blocked` leads because it is the only lane an operator can act on. */
export const LANE_LABELS: Record<LaneId, { id: string; en: string }> = {
  blocked: { id: 'Tertahan', en: 'waiting on you' },
  active: { id: 'Dikerjakan', en: 'in progress' },
  queued: { id: 'Menunggu giliran', en: 'queued' },
  done: { id: 'Selesai', en: 'done' },
  stopped: { id: 'Terhenti', en: 'stopped' },
}

export const STATE_LABELS: Record<TaskState, string> = {
  submitted: 'terkirim',
  working: 'dikerjakan',
  input_required: 'menunggu jawaban',
  auth_required: 'menunggu izin',
  completed: 'selesai',
  failed: 'gagal',
  canceled: 'dibatalkan',
  rejected: 'ditolak',
}

/** Where the work came from, in words rather than a protocol token. */
export const ORIGIN_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  a2a: 'antar-agen',
  desktop: 'Desktop',
  cron: 'terjadwal',
  otlp: 'telemetri',
}

const EMPTY_LANES: Record<LaneId, Amanat[]> = {
  blocked: [], active: [], queued: [], done: [], stopped: [],
}
const EMPTY_COUNTS: Record<LaneId, number> = {
  blocked: 0, active: 0, queued: 0, done: 0, stopped: 0,
}

function isState(v: unknown): v is TaskState {
  return typeof v === 'string' && v in STATE_LABELS
}

function isLane(v: unknown): v is LaneId {
  return typeof v === 'string' && (LANE_ORDER as string[]).includes(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Accept only a task we can render honestly. A row missing an id or carrying
 * a state we do not know is dropped rather than coerced — a board that shows
 * a task in the wrong lane is worse than one that shows it nowhere, because
 * the wrong lane is still believed.
 */
function normalise(raw: unknown): Amanat | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const id = str(d.id)
  if (!id || !isState(d.state)) return null
  const lane = isLane(d.lane) ? d.lane : 'queued'
  const created = typeof d.createdTs === 'number' ? d.createdTs : 0
  const updated = typeof d.updatedTs === 'number' ? d.updatedTs : created
  return {
    id,
    state: d.state,
    lane,
    agent: str(d.agent),
    origin: str(d.origin),
    title: str(d.title),
    repo: str(d.repo),
    peer: str(d.peer),
    createdTs: created,
    updatedTs: updated,
    blocked: lane === 'blocked',
    redacted: d.redacted === true,
  }
}

export function useAmanat(opts: UseAmanatOptions = {}): AmanatState {
  const { fetchImpl, pollMs = AMANAT_POLL_MS, autoStart = true, nudge = 0 } = opts
  const doFetch: FetchLike = fetchImpl ?? ((i, n) => fetch(i, n))

  const [lanes, setLanes] = useState<Record<LaneId, Amanat[]>>(EMPTY_LANES)
  const [counts, setCounts] = useState<Record<LaneId, number>>(EMPTY_COUNTS)
  const [total, setTotal] = useState(0)
  const [redacted, setRedacted] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [stale, setStale] = useState(false)
  const [lastOkTs, setLastOkTs] = useState<number | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await doFetch('/tasks', { credentials: 'include' })
      if (!alive.current) return
      if (!res.ok) {
        // A 401 on a cold load means the guest session has not been minted
        // yet, not that the board is gone. Keep what we have.
        setStale(true)
        return
      }
      const data = (await res.json()) as Record<string, unknown>
      if (!alive.current) return

      const src = (data.lanes ?? {}) as Record<string, unknown>
      const next: Record<LaneId, Amanat[]> = { ...EMPTY_LANES }
      const nextCounts: Record<LaneId, number> = { ...EMPTY_COUNTS }
      for (const lane of LANE_ORDER) {
        const rows = Array.isArray(src[lane]) ? (src[lane] as unknown[]) : []
        const list = rows.map(normalise).filter((t): t is Amanat => t !== null)
        next[lane] = list
        nextCounts[lane] = list.length
      }
      setLanes(next)
      setCounts(nextCounts)
      setTotal(typeof data.total === 'number' ? data.total : Object.values(nextCounts).reduce((a, b) => a + b, 0))
      setRedacted(data.redacted === true)
      setLastOkTs(Date.now())
      setStale(false)
      setLoaded(true)
    } catch {
      if (alive.current) setStale(true)
    }
  }, [doFetch])

  useEffect(() => {
    alive.current = true
    if (!autoStart) return () => { alive.current = false }
    void refresh()
    const h = setInterval(() => { void refresh() }, pollMs)
    return () => {
      alive.current = false
      clearInterval(h)
    }
  }, [refresh, pollMs, autoStart])

  // Socket nudge: refetch as soon as a task-bearing event lands, so the board
  // tracks reality instead of the 15s poll boundary.
  useEffect(() => {
    if (nudge > 0) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge])

  return {
    lanes,
    order: LANE_ORDER,
    counts,
    total,
    blocked: counts.blocked,
    redacted,
    loaded,
    stale,
    lastOkTs,
    refresh,
  }
}
