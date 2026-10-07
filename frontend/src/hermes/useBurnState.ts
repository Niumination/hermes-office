import { useEffect, useRef, useState } from 'react'
import type { HermesEnvelope } from './types'

/**
 * useBurnState — one shared source of truth for how hot the office is.
 *
 * WHAT WENT WRONG BEFORE
 * ----------------------
 * Two components independently polled `/burn` on timers: BurnOverlay every 3 s
 * for the dollar figures, and OfficeStage every 5 s to drive the atmosphere
 * shader. That is ~1,440 requests per hour per open tab, for data the server
 * was *already pushing*: `budget_state` is broadcast over the WebSocket the
 * moment the state changes (server/burnrate.js emits on transition only).
 * Two pollers also meant the HUD and the room lighting could disagree for up
 * to five seconds, so the room would still look calm while the HUD said hot.
 *
 * THE SHAPE OF THE FIX
 * --------------------
 * The WebSocket cannot be the only source, because it carries no history: a
 * tab opened after the last transition would show `normal` until the next one,
 * which may be hours away. And `budget_state` deliberately carries only
 * `{scope, state, from, source, ts}` — no dollar figures, because guests must
 * never receive them.
 *
 * So: seed once from `/burn` at mount, then let the socket drive the state
 * label instantly, and re-fetch the full snapshot *only when a transition
 * actually happens*. Steady state costs zero requests. A busy day with twenty
 * transitions costs twenty-one.
 */

// The canonical shape lives with the component that renders every field of
// it. Two near-identical definitions had already drifted apart — one made
// spentDayUsd optional — and TypeScript caught the mismatch only at the call
// site, which is the wrong place to learn about it.
export type { BurnState, BurnSnapshot } from '../components/BurnOverlay'
import type { BurnState } from '../components/BurnOverlay'
import type { BurnSnapshot } from '../components/BurnOverlay'

const VALID: ReadonlySet<string> = new Set<BurnState>([
  'normal', 'warm', 'hot', 'critical', 'tripped',
])

export interface UseBurnStateResult {
  /** Current global state. Always defined — defaults to `normal` before seed. */
  state: BurnState
  /** Full snapshot including dollar figures. Null until the seed lands. */
  snapshot: BurnSnapshot | null
  /** True once the seed request has settled, success or failure. */
  ready: boolean
}

export function useBurnState(envelopes: HermesEnvelope[]): UseBurnStateResult {
  const [snapshot, setSnapshot] = useState<BurnSnapshot | null>(null)
  const [state, setState] = useState<BurnState>('normal')
  const [ready, setReady] = useState(false)

  // Guards against a slow refetch landing after a newer transition and
  // dragging the UI back to a stale state.
  const seq = useRef(0)
  const aliveRef = useRef(true)

  const refetch = async () => {
    const mine = ++seq.current
    try {
      const r = await fetch('/burn', { credentials: 'include' })
      if (!r.ok) return
      const j = (await r.json()) as BurnSnapshot
      // Discard if another refetch started while this one was in flight.
      if (!aliveRef.current || mine !== seq.current) return
      setSnapshot(j)
      const s = j?.global?.state
      if (s && VALID.has(s)) setState(s)
    } catch {
      // Keep the last known figures. Blanking the HUD because one request
      // failed is worse than showing figures that are a few seconds old.
    }
  }

  // --- seed ----------------------------------------------------------------
  useEffect(() => {
    aliveRef.current = true
    void refetch().finally(() => {
      if (aliveRef.current) setReady(true)
    })
    return () => { aliveRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- live transitions ----------------------------------------------------
  // Only the newest batch is scanned, and only the last budget_state in it
  // matters: intermediate hops within one batch are already superseded.
  useEffect(() => {
    if (!envelopes.length) return
    let latest: BurnState | null = null
    for (const ev of envelopes) {
      if (ev?.type !== 'budget_state') continue
      // Agent-scoped transitions must not overwrite the global reading; the
      // shader and the HUD both describe the room as a whole.
      const scope = (ev as { scope?: string }).scope
      if (scope && scope !== 'global') continue
      const s = (ev as { state?: string }).state
      if (s && VALID.has(s)) latest = s as BurnState
    }
    if (!latest) return

    // Paint the new state immediately from the push, then reconcile the
    // numbers. The label is what drives the lighting, so it must not wait on
    // a round trip.
    setState(latest)
    void refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelopes])

  return { state, snapshot, ready }
}

export default useBurnState
