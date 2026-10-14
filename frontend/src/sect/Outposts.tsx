/**
 * Pos Jaga — the fourth panel of the right-hand scroll.
 *
 * Babad is what the fleet did, Murid is who is present, Sabda is what was
 * said, Pos Jaga is what the sect watches from a distance: cron jobs and
 * sibling services the office does not run and cannot command.
 *
 * Four states, four different truths, and the fourth one is the important
 * one. `unknown` is rendered as its own thing — not a red light. An outpost
 * we failed to reach has not failed; we failed to ask. Painting that red
 * trains an operator to ignore red, and then the real failure goes unseen.
 *
 * Phase one: observation only, no buttons. Phase two adds owner-only action
 * buttons with confirmation dialogs and visible cooldown. Guests see the same
 * panel as phase one — no buttons, no action list.
 */
import React, { useState, useCallback } from 'react'
import type { Outpost, OutpostState } from './useOutposts'
import { SECT_HALLS } from '../theme/sect'

/**
 * A desk's `hall` is a free-form string from an owner-written JSON file, not
 * a RoomId the compiler can vouch for. Looking it up through a widened view
 * keeps an unknown hall from being a type error here and a crash there: an
 * unrecognised name simply renders no hall, which is the honest outcome.
 */
const HALL_BY_ID = SECT_HALLS as Record<string, { nameId: string } | undefined>

/** Sect names for the four states. */
const STATE_LABEL: Record<OutpostState, string> = {
  ok: 'Aman',
  failed: 'Genting',
  stale: 'Senyap',
  unknown: 'Tak Terjangkau',
}

/** Longer gloss, shown as a title so the metaphor never hides the meaning. */
const STATE_GLOSS: Record<OutpostState, string> = {
  ok: 'Pos menjawab dan sehat',
  failed: 'Pos menjawab, tetapi tidak sebagaimana mestinya',
  stale: 'Pos sehat terakhir kali, tetapi sudah terlalu lama diam',
  unknown: 'Kami tidak berhasil bertanya — bukan berarti ia rusak',
}

function clock(ts: number | null): string {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(ts))
  } catch { return '—' }
}

function cooldownLabel(ms: number): string {
  if (ms <= 0) return 'Siap'
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}d`
  const m = Math.floor(s / 60)
  const sec = s % 60
  return sec > 0 ? `${m}m${sec}s` : `${m}m`
}

export interface OutpostsProps {
  outposts: Outpost[]
  problems: string[]
  loaded: boolean
  stale: boolean
  lastOkTs: number | null
  /** True when the viewer has owner rights; buttons appear only then. */
  isOwner: boolean
  /** Optional callback to run an action; default fetches POST /desks/:id/actions/:actionId. */
  onRunAction?: (deskId: string, actionId: string) => Promise<{ ok: boolean; exitCode: number; ms: number }>
}

interface ActionState {
  running: boolean
  result: { ok: boolean; exitCode: number; ms: number } | null
  cooldownMs: number
}

export default function Outposts(props: OutpostsProps) {
  const { outposts, problems, loaded, stale, lastOkTs, isOwner, onRunAction } = props
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [confirmTarget, setConfirmTarget] = useState<{ deskId: string; action: { id: string; label: string; cooldownMs: number } } | null>(null)

  const runAction = useCallback(async (deskId: string, actionId: string) => {
    const fn = onRunAction ?? ((d, a) =>
      fetch(`/desks/${encodeURIComponent(d)}/actions/${encodeURIComponent(a)}`, {
        method: 'POST',
        credentials: 'include',
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ ok: boolean; exitCode: number; ms: number }>
      })
    )
    setActionStates((prev) => ({
      ...prev,
      [`${deskId}::${actionId}`]: { running: true, result: null, cooldownMs: (prev[`${deskId}::${actionId}`]?.cooldownMs ?? 0) },
    }))
    try {
      const result = await fn(deskId, actionId)
      const remaining = result.ok ? 0 : (actionStates[`${deskId}::${actionId}`]?.cooldownMs ?? 0)
      setActionStates((prev) => ({
        ...prev,
        [`${deskId}::${actionId}`]: { running: false, result, cooldownMs: remaining },
      }))
    } catch {
      setActionStates((prev) => ({
        ...prev,
        [`${deskId}::${actionId}`]: { running: false, result: { ok: false, exitCode: -1, ms: 0 }, cooldownMs: 0 },
      }))
    }
  }, [onRunAction, actionStates])

  const startCooldown = useCallback((deskId: string, actionId: string, ms: number) => {
    const key = `${deskId}::${actionId}`
    setActionStates((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { running: false, result: null }), cooldownMs: ms },
    }))
  }, [])

  // Ticker to drive the cooldown countdown visible in the UI.
  const [, setTick] = useState(0)
  React.useEffect(() => {
    if (Object.keys(actionStates).length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [actionStates])

  const handleRun = useCallback((deskId: string, action: { id: string; label: string; confirm: boolean; cooldownMs: number }) => {
    if (action.confirm) {
      setConfirmTarget({ deskId, action })
    } else {
      void runAction(deskId, action.id)
    }
  }, [runAction])

  const confirmRun = useCallback(() => {
    if (!confirmTarget) return
    const { deskId, action } = confirmTarget
    setConfirmTarget(null)
    void runAction(deskId, action.id)
  }, [confirmTarget, runAction])

  return (
    <div className="sect-log sect-posts" data-testid="outposts-panel">
      {stale && (
        <p className="sect-posts__stale" role="status" data-testid="outposts-stale">
          Kabar terakhir {clock(lastOkTs)} — perguruan belum terhubung kembali.
        </p>
      )}

      {loaded && outposts.length === 0 && (
        <p className="sect-log__empty">
          Belum ada pos jaga. Tunjuk <code>OFFICE_DESKS_FILE</code> ke berkas
          seperti <code>desks.example.json</code>.
        </p>
      )}

      {outposts.map((o) => {
        const hall = o.hall ? HALL_BY_ID[o.hall] : undefined
        const hasActions = isOwner && o.actions && o.actions.length > 0
        return (
          <article
            key={o.id}
            className={`sect-post is-${o.state}${hasActions ? ' sect-post--has-actions' : ''}`}
            data-testid="outpost"
            data-state={o.state}
          >
            <span className="sect-post__lamp" aria-hidden="true" />
            <div className="sect-post__body">
              <header className="sect-post__head">
                <span className="sect-post__name">{o.label}</span>
                <span className="sect-post__state" title={STATE_GLOSS[o.state]}>
                  {STATE_LABEL[o.state]}
                </span>
              </header>

              <p className="sect-post__meta">
                {hall && <span className="sect-post__hall">{hall.nameId}</span>}
                {hall && ' · '}
                <span className="sect-post__kind">{o.kind === 'file' ? 'berkas' : 'http'}</span>
                {o.lastTs != null && <> · terakhir {clock(o.lastTs)}</>}
                {o.checkedTs != null && <> · diperiksa {clock(o.checkedTs)}</>}
              </p>

              {o.note && <p className="sect-post__note">{o.note}</p>}

              {/* Shown verbatim when the server sends it; a guest gets null
                  because the detail is where internal hosts leak. */}
              {o.detail && <p className="sect-post__detail">{o.detail}</p>}

              {/* Owner-only action buttons */}
              {hasActions && (
                <div className="sect-post__actions" data-testid="outpost-actions">
                  {o.actions!.map((a) => {
                    const key = `${o.id}::${a.id}`
                    const state = actionStates[key] ?? { running: false, result: null, cooldownMs: 0 }
                    const canRun = !state.running && state.cooldownMs <= 0
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`sect-post__action${!canRun ? ' sect-post__action--busy' : ''}`}
                        disabled={!canRun}
                        onClick={() => handleRun(o.id, a)}
                        title={
                          state.running
                            ? 'Sedang berjalan…'
                            : state.cooldownMs > 0
                              ? `Jeda: ${cooldownLabel(state.cooldownMs)}`
                              : `Jalankan ${a.label}`
                        }
                        data-testid={`action-${a.id}`}
                      >
                        {state.running
                          ? '⏳ Berjalan…'
                          : state.result
                            ? state.result.ok
                              ? `✓ ${state.result.ms}ms`
                              : `✗ exit ${state.result.exitCode}`
                            : a.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </article>
        )
      })}

      {problems.length > 0 && (
        <div className="sect-posts__problems" data-testid="outposts-problems">
          <p className="sect-posts__problems-h">Berkas pos jaga bermasalah:</p>
          <ul>
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmTarget && (
        <dialog
          open
          className="sect-dialog"
          data-testid="confirm-dialog"
          onClose={() => setConfirmTarget(null)}
        >
          <div className="sect-dialog__inner">
            <h3 className="sect-dialog__title">Konfirmasi Aksi</h3>
            <p className="sect-dialog__body">
              Jalankan <strong>{confirmTarget.action.label}</strong> di{' '}
              <strong>{outposts.find((o) => o.id === confirmTarget.deskId)?.label ?? confirmTarget.deskId}</strong>?
            </p>
            {confirmTarget.action.cooldownMs > 0 && (
              <p className="sect-dialog__cooldown">
                Jeda setelah dijalankan: {cooldownLabel(confirmTarget.action.cooldownMs)}
              </p>
            )}
            <div className="sect-dialog__acts">
              <button type="button" className="sect-dialog__cancel" onClick={() => setConfirmTarget(null)}>
                Batal
              </button>
              <button type="button" className="sect-dialog__confirm" onClick={confirmRun}>
                Ya, jalankan
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
