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
 * buttons with confirmation dialogs and visible cooldown. Signed out the
 * panel as phase one — no buttons, no action list.
 */
import React, { useState, useCallback } from 'react'
import type { Outpost, OutpostState } from './useOutposts'
import { ROOMS } from '../eco/ecosystem'

/**
 * An outpost's `hall` is a free-form string from an owner-written JSON file,
 * so it is matched against the ecosystem rooms rather than the fork's eight
 * halls. Rooms are searched across BOTH offices on purpose: an outpost is a
 * thing watched from a distance and has no reason to sit in whichever office
 * the viewer happens to be looking at.
 */
const ROOM_LABEL: Record<string, string> = Object.fromEntries(
  ROOMS.map((r) => [r.id, r.label]),
)

/**
 * The old version dropped any name it did not recognise and called that "the
 * honest outcome". It was not: the owner wrote a hall down, and the screen
 * quietly decided not to repeat it. An unrecognised name is now shown as the
 * owner typed it, marked as unmatched rather than deleted.
 */
function hallOf(raw: string | null | undefined): { text: string; known: boolean } | undefined {
  if (!raw) return undefined
  const known = ROOM_LABEL[raw]
  return known ? { text: known, known: true } : { text: raw, known: false }
}

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
  /**
   * Epoch ms at which the cooldown expires, not a duration. A stored duration
   * never shrinks on its own, so the ticker below would re-render a frozen
   * number for ever and the button would never unlock. A deadline compared
   * against Date.now() at render time counts down by itself.
   *
   * Set when the action is launched, never when it finishes: the server
   * reserves the cooldown slot before it awaits the child process, so a run
   * that fails in one second still holds the slot for the full window. The UI
   * has to agree with that, or it offers a button the server answers with 429.
   */
  cooldownUntil: number
}

export default function Outposts(props: OutpostsProps) {
  const { outposts, problems, loaded, stale, lastOkTs, isOwner, onRunAction } = props
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [confirmTarget, setConfirmTarget] = useState<{ deskId: string; action: { id: string; label: string; cooldownMs: number } } | null>(null)

  const runAction = useCallback(async (deskId: string, actionId: string, cooldownMs: number) => {
    const fn = onRunAction ?? ((d, a) =>
      fetch(`/desks/${encodeURIComponent(d)}/actions/${encodeURIComponent(a)}`, {
        method: 'POST',
        credentials: 'include',
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ ok: boolean; exitCode: number; ms: number }>
      })
    )
    // Start the cooldown here, at launch, to mirror the server reserving its
    // slot before the await. Both outcomes below keep this deadline.
    const until = Date.now() + Math.max(0, cooldownMs)
    const key = `${deskId}::${actionId}`
    setActionStates((prev) => ({
      ...prev,
      [key]: { running: true, result: null, cooldownUntil: until },
    }))
    try {
      const result = await fn(deskId, actionId)
      setActionStates((prev) => ({
        ...prev,
        [key]: { running: false, result, cooldownUntil: until },
      }))
    } catch {
      // A transport error is not proof the action did not run — the request may
      // have reached the server and been recorded. Holding the cooldown is the
      // cautious reading, and caution is the right failure direction here.
      setActionStates((prev) => ({
        ...prev,
        [key]: { running: false, result: { ok: false, exitCode: -1, ms: 0 }, cooldownUntil: until },
      }))
    }
  }, [onRunAction])

  // Ticker to drive the cooldown countdown visible in the UI. It runs only
  // while something is actually counting down — keying it on "any action has
  // ever been clicked" would leave a 250 ms timer running for the rest of the
  // session after the last cooldown expired.
  const [, setTick] = useState(0)
  const counting = Object.values(actionStates).some(
    (s) => s.running || s.cooldownUntil > Date.now(),
  )
  React.useEffect(() => {
    if (!counting) return
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [counting])

  const handleRun = useCallback((deskId: string, action: { id: string; label: string; confirm: boolean; cooldownMs: number }) => {
    if (action.confirm) {
      setConfirmTarget({ deskId, action })
    } else {
      void runAction(deskId, action.id, action.cooldownMs)
    }
  }, [runAction])

  const confirmRun = useCallback(() => {
    if (!confirmTarget) return
    const { deskId, action } = confirmTarget
    setConfirmTarget(null)
    void runAction(deskId, action.id, action.cooldownMs)
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
        const hall = hallOf(o.hall)
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
                {hall && (
                  <span
                    className={`sect-post__hall${hall.known ? '' : ' sect-post__hall--unmatched'}`}
                    title={hall.known
                      ? 'Ruang di ekosistem'
                      : 'Nama ruang dari berkas Anda yang tidak cocok dengan ruang mana pun'}
                  >
                    {hall.text}
                  </span>
                )}
                {hall && ' · '}
                <span className="sect-post__kind">{o.kind === 'file' ? 'berkas' : 'http'}</span>
                {o.lastTs != null && <> · terakhir {clock(o.lastTs)}</>}
                {o.checkedTs != null && <> · diperiksa {clock(o.checkedTs)}</>}
              </p>

              {o.note && <p className="sect-post__note">{o.note}</p>}

              {/* Shown verbatim when the server sends it; a probe that has
                  because the detail is where internal hosts leak. */}
              {o.detail && <p className="sect-post__detail">{o.detail}</p>}

              {/* Owner-only action buttons */}
              {hasActions && (
                <div className="sect-post__actions" data-testid="outpost-actions">
                  {o.actions!.map((a) => {
                    const key = `${o.id}::${a.id}`
                    const state = actionStates[key] ?? { running: false, result: null, cooldownUntil: 0 }
                    const remainingMs = Math.max(0, state.cooldownUntil - Date.now())
                    const canRun = !state.running && remainingMs <= 0
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
                            : remainingMs > 0
                              ? `Jeda: ${cooldownLabel(remainingMs)}`
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
