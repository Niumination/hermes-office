/**
 * ApprovalGate — the human standing at the door.
 *
 * When an agent asks to enter a privileged room, or to use a tool that room
 * gates, the request stops here until a person decides. This panel is the
 * whole point of "doors are policy gates": the approval is not a line in a
 * log, it is a thing visibly blocking the floor.
 *
 * Only an owner can resolve; guests see the queue read-only, which is
 * deliberate — knowing that something is waiting is not privileged, deciding
 * it is.
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
  model?: string
  reason?: string
  redacted?: boolean
  createdAt: number
  expiresAt: number
}

const TRUST_ICON: Record<string, string> = {
  entry: '🚪',
  tool: '🔑',
}

function countdown(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.round((expiresAt - now) / 1000))
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

export const ApprovalGate: React.FC<{ pollMs?: number; canApprove?: boolean }> = ({
  pollMs = 2000,
  canApprove,
}) => {
  // The server redacts agent/tool for guests, so the payload tells us the
  // viewer's role without a second request. Showing approve/deny buttons that
  // are guaranteed to 403 is worse than showing none.
  const [inferredOwner, setInferredOwner] = useState(false)
  const mayApprove = canApprove ?? inferredOwner
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
          const j = await r.json()
          const list: Approval[] = Array.isArray(j.pending) ? j.pending : []
          setPending(list)
          setInferredOwner(list.length > 0 && !(list[0] as any).redacted)
          failures = 0
        } else failures++
      } catch {
        failures++
      }
      if (!alive) return
      setNow(Date.now())
      timer = setTimeout(tick, failures > 3 ? Math.min(pollMs * 10, 30_000) : pollMs)
    }

    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [pollMs])

  const resolve = useCallback(async (id: string, approve: boolean) => {
    setBusy(id)
    setError(null)
    try {
      const r = await fetch(`/approvals/${encodeURIComponent(id)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setError(j.error || `failed (${r.status})`)
      } else {
        // Drop it immediately rather than waiting for the next poll.
        setPending(p => p.filter(a => a.id !== id))
      }
    } catch {
      setError('network error')
    } finally {
      setBusy(null)
    }
  }, [])

  if (pending.length === 0) return null

  return (
    <div className="approval-gate" data-testid="approval-gate">
      <div className="approval-gate-head">
        <span className="approval-gate-knock" aria-hidden="true">🚪</span>
        <span className="approval-gate-title">
          {pending.length === 1 ? 'ada yang di pintu' : `${pending.length} menunggu di pintu`}
        </span>
      </div>

      {error && <div className="approval-error">{error}</div>}

      <ul className="approval-list">
        {pending.map(a => (
          <li key={a.id} className={`approval-item approval-${a.kind}`}>
            <div className="approval-line">
              <span className="approval-icon" aria-hidden="true">{TRUST_ICON[a.kind] ?? '❓'}</span>
              <span className="approval-agent">{a.agent}</span>
              <span className="approval-verb">
                {a.kind === 'entry' ? 'ingin masuk' : 'ingin menjalankan'}
              </span>
              <span className="approval-target">{a.kind === 'entry' ? a.room : a.tool}</span>
            </div>

            <div className="approval-meta">
              {a.kind === 'entry' && a.fromRoom && <span>dari {a.fromRoom}</span>}
              {a.kind === 'tool' && <span>di {a.room}</span>}
              <span className="approval-timer" title="waktu hingga permintaan ini kedaluwarsa">
                kedaluwarsa dalam {countdown(a.expiresAt, now)}
              </span>
            </div>

            {mayApprove ? (
              <div className="approval-actions">
                <button
                  type="button"
                  className="approval-btn approval-deny"
                  disabled={busy === a.id}
                  onClick={() => resolve(a.id, false)}
                >
                  tolak
                </button>
                <button
                  type="button"
                  className="approval-btn approval-allow"
                  disabled={busy === a.id}
                  onClick={() => resolve(a.id, true)}
                >
                  setujui
                </button>
              </div>
            ) : (
              <div className="approval-meta approval-readonly">butuh keputusan pemilik</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ApprovalGate
