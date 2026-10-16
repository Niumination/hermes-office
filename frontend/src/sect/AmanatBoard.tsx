/**
 * AmanatBoard — the task board, as a floating overlay.
 *
 * Why an overlay instead of the tab it started as
 * -----------------------------------------------
 * A board wants its lanes side by side; that is the entire reason a board
 * beats a list. The right rail is ~330px, so five lanes there became five
 * stacked sections — readable, but no longer a board.
 *
 * The-Office solves the same tension the same way: the Kanban is not a panel,
 * it is a modal over the office with a dimmed backdrop, opened from a button
 * floating on the canvas. That gets the full window width, which is what the
 * lanes needed.
 *
 * Behaviours carried over from their implementation: click the backdrop to
 * close, stop propagation inside the board, Escape to dismiss, and a count
 * badge per column.
 *
 * What is deliberately not carried over: drag-and-drop between columns. In
 * The-Office the operator owns the board, so dragging a card is a real
 * instruction. Here the board is a *mirror* — lane membership is derived from
 * the A2A lifecycle the agents report. A card you could drag would imply the
 * office can change what an agent is doing, which is a promise this product
 * does not keep. The UI must not invent authority it does not have.
 */
import React from 'react'
import type { Amanat as AmanatTask, AmanatState, LaneId } from './useAmanat'
import { LANE_LABELS, ORIGIN_LABELS, STATE_LABELS } from './useAmanat'

function ago(ts: number, now: number): string {
  if (!ts) return ''
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return 'baru'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} mnt`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} jam`
  return `${Math.round(h / 24)} hr`
}

/** Initials, the way The-Office badges an assignee. */
function initials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function Card({ task, now }: { task: AmanatTask; now: number }) {
  const where = task.origin ? (ORIGIN_LABELS[task.origin] ?? task.origin) : null
  const title = task.title ?? (task.redacted ? '[tersembunyi]' : task.id)
  return (
    <article className={`amanat-card${task.blocked ? ' amanat-card--blocked' : ''}`}>
      <div className="amanat-card__title">{title}</div>
      <div className="amanat-card__foot">
        {task.agent && (
          <span className="amanat-card__who" title={task.agent}>
            <span className="amanat-card__avatar" aria-hidden="true">{initials(task.agent)}</span>
            {task.agent}
          </span>
        )}
        <span className="amanat-card__age">{ago(task.updatedTs, now)}</span>
      </div>
      <div className="amanat-card__meta">
        <span>{STATE_LABELS[task.state]}</span>
        {where && <span>lewat {where}</span>}
        {task.repo && task.repo !== '[redacted]' && (
          <span className="amanat-card__repo">{task.repo}</span>
        )}
      </div>
    </article>
  )
}

function Column({ id, tasks, now }: { id: LaneId; tasks: AmanatTask[]; now: number }) {
  const label = LANE_LABELS[id]
  return (
    <section className={`amanat-col amanat-col--${id}`}>
      <header className="amanat-col__head">
        <h4>{label.id}</h4>
        <span className="amanat-col__count">{tasks.length}</span>
      </header>
      <div className="amanat-col__body">
        {tasks.length === 0 ? (
          <p className="amanat-col__empty">—</p>
        ) : (
          tasks.map((t) => <Card key={t.id} task={t} now={now} />)
        )}
      </div>
    </section>
  )
}

export default function AmanatBoard({
  board,
  onClose,
  now = Date.now(),
}: {
  board: AmanatState
  onClose: () => void
  now?: number
}) {
  const { order, lanes, total, blocked, redacted, stale, loaded } = board

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="amanat-overlay" onClick={onClose} role="presentation">
      <div
        className="amanat-board"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Papan Amanat"
      >
        <header className="amanat-board__head">
          <h3 className="sect-script">Amanat</h3>
          <span className="amanat-board__sub">
            {loaded || total > 0 ? `${total} amanat` : 'memuat…'}
            {blocked > 0 && <strong className="amanat-board__alert"> · {blocked} menunggu Anda</strong>}
            {redacted && <span className="amanat-board__veil"> · judul disembunyikan</span>}
            {stale && <span className="amanat-board__veil"> · tak tersambung</span>}
          </span>
          <button
            type="button"
            className="amanat-board__close"
            onClick={onClose}
            aria-label="Tutup papan"
          >
            ✕
          </button>
        </header>

        {total === 0 ? (
          <div className="amanat-board__empty">
            <p>Belum ada amanat.</p>
            <p className="amanat-board__hint">
              Papan ini terisi saat gateway mengirim <code>task_update</code>.
              Lihat <code>bridges/hermes-emit</code>.
            </p>
          </div>
        ) : (
          <div className="amanat-board__cols">
            {order.map((id) => (
              <Column key={id} id={id} tasks={lanes[id]} now={now} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
