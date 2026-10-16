/**
 * Titah — the writ.
 *
 * An agent asking to enter a hall above its station, or to use a tool that
 * hall gates, stops here until a person decides. This is the visible half of
 * "doors are policy gates": the request is not a line in a log, it is a thing
 * standing in the courtyard, waiting.
 *
 * Restored from the old `ApprovalGate`, which the sect rebuild dropped. Its
 * two rules are kept exactly:
 *
 *   - No button that is guaranteed to 403. The controls are absent rather
 *     than present-and-futile.
 *
 * Ownership used to be *inferred* from the payload, because a guest got the
 * same queue with `agent` and `tool` redacted and a `redacted: true` marker.
 * With one principal that inference is dead weight: anyone who can read this
 * queue at all is the owner, so `canApprove` defaults to true and the caller
 * may still override it.
 */
import React, { useCallback, useEffect, useState } from 'react'

export interface Approval {
  id: string
  kind: 'entry' | 'tool'
  status: 'pending' | 'approved' | 'denied' | 'expired'
  agent?: string
  room: string
  fromRoom?: string
  tool?: string | null
  reason?: string
  createdAt: number
  expiresAt: number
}

const KIND_MARK: Record<string, string> = { entry: 'Gerbang', tool: 'Alat' }

function countdown(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.round((expiresAt - now) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export const Writ: React.FC<{ pollMs?: number; canApprove?: boolean }> = ({
  pollMs = 2000,
  canApprove,
}) => {
  // One principal: reading the queue and deciding it are the same standing.
  const mayApprove = canApprove ?? true
  const [pending, setPending] = useState<Approval[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    let failures = 0

    const tick = async () => {
      try {
        const r = await fetch('/approvals', { credentials: 'include' })
        if (r.ok && alive) {
          const body = await r.json()
          const list: Approval[] = Array.isArray(body?.pending) ? body.pending : []
          setPending(list)
          failures = 0
          setError(null)
        } else {
          failures += 1
        }
      } catch {
        /* transient: keep the queue rather than blanking it */
        failures += 1
      }
      if (alive) {
        setNow(Date.now())
        // Back off a server that is refusing or down rather than polling it
        // every two seconds forever.
        timer = setTimeout(tick, failures > 3 ? Math.min(pollMs * 10, 30_000) : pollMs)
      }
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [pollMs])

  const resolve = useCallback(async (id: string, approve: boolean) => {
    setBusy(id)
    try {
      const r = await fetch(`/approvals/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ approve }),
      })
      if (r.ok) {
        setPending((p) => p.filter((a) => a.id !== id))
        setError(null)
      } else {
        // Say what the server said. Dropping the row here would show a
        // decision that did not happen.
        const body = await r.json().catch(() => null)
        setError(body?.error ?? `Server menolak (http ${r.status})`)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }, [])

  if (pending.length === 0) return null

  return (
    <section className="sect-writ" aria-label="Titah — menunggu keputusan">
      <header className="sect-writ__head">
        <span className="sect-script">Titah</span>
        <span className="sect-writ__gloss">
          {pending.length} menunggu keputusan
        </span>
      </header>

      {error && <p className="sect-writ__error" role="alert">{error}</p>}

      <ul className="sect-writ__list">
        {pending.map((a) => (
          <li key={a.id} className="sect-writ__item">
            <span className="sect-writ__kind" aria-hidden="true">
              {KIND_MARK[a.kind] ?? 'Titah'}
            </span>
            <span className="sect-writ__what">
              <strong>{a.agent ?? 'pemohon tak dikenal'}</strong>{' '}
              {a.kind === 'entry'
                ? `memohon masuk ${a.room}`
                : `memohon ${a.tool ?? 'sebuah alat'} di ${a.room}`}
              {a.reason && <em className="sect-writ__why"> — {a.reason}</em>}
            </span>
            <span className="sect-writ__clock" title="sisa waktu sebelum kedaluwarsa">
              {countdown(a.expiresAt, now)}
            </span>
            {mayApprove && (
              <span className="sect-writ__acts">
                <button type="button" disabled={busy === a.id}
                        onClick={() => resolve(a.id, true)}>Restui</button>
                <button type="button" disabled={busy === a.id}
                        onClick={() => resolve(a.id, false)}>Tolak</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default Writ
