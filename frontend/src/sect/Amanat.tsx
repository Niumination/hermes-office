/**
 * Amanat — the board of what the fleet is working on.
 *
 * Grouped lanes rather than side-by-side Kanban columns. The right rail is
 * roughly 320px wide; five columns in that space produce five unreadable
 * slivers. Lanes stacked vertically keep every title legible, and the one
 * thing a horizontal board buys — seeing all states at once — is preserved by
 * the count strip at the top.
 *
 * `Tertahan` is pinned first and styled loudest on purpose. A task waiting on
 * a human is the only kind the operator can clear right now; burying it under
 * forty completed ones would make the board decorative.
 */
import type { Amanat as AmanatTask, AmanatState, LaneId } from './useAmanat'
import { LANE_LABELS, ORIGIN_LABELS, STATE_LABELS } from './useAmanat'

/**
 * Relative age, short enough to sit on one line beside the title.
 *
 * Seconds read as "baru" rather than "57d": `d` for *detik* is one letter away
 * from `h` for *hari*, and a task that started a minute ago looked like one
 * that started two months ago in the first screenshot of this panel.
 */
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

function originLabel(origin: string | null): string | null {
  if (!origin) return null
  return ORIGIN_LABELS[origin] ?? origin
}

function Row({ task, now }: { task: AmanatTask; now: number }) {
  const where = originLabel(task.origin)
  // A redacted title is shown as a visible placeholder rather than hidden.
  // A guest should be able to see that work exists and that they are not
  // being shown it — silently dropping the row would misreport the fleet as
  // idle, which is a different lie from "you may not read this".
  const title = task.title ?? (task.redacted ? '[tersembunyi]' : task.id)

  return (
    <article className={`sect-amanat__row${task.blocked ? ' sect-amanat__row--blocked' : ''}`}>
      <div className="sect-amanat__head">
        <span className="sect-amanat__title">{title}</span>
        <span className="sect-amanat__age" title={new Date(task.updatedTs).toLocaleString('id-ID')}>
          {ago(task.updatedTs, now)}
        </span>
      </div>
      <div className="sect-amanat__meta">
        {task.agent && <span className="sect-amanat__agent">{task.agent}</span>}
        <span className="sect-amanat__state">{STATE_LABELS[task.state]}</span>
        {where && <span className="sect-amanat__origin">lewat {where}</span>}
        {task.repo && task.repo !== '[redacted]' && (
          <span className="sect-amanat__repo">{task.repo}</span>
        )}
      </div>
    </article>
  )
}

function Lane({ id, tasks, now }: { id: LaneId; tasks: AmanatTask[]; now: number }) {
  if (tasks.length === 0) return null
  const label = LANE_LABELS[id]
  return (
    <section className={`sect-amanat__lane sect-amanat__lane--${id}`}>
      <h4 className="sect-amanat__laneHead">
        <span>{label.id}</span>
        <span className="sect-amanat__laneCount">{tasks.length}</span>
      </h4>
      {tasks.map((t) => (
        <Row key={t.id} task={t} now={now} />
      ))}
    </section>
  )
}

export default function Amanat({
  board,
  now = Date.now(),
}: {
  board: AmanatState
  now?: number
}) {
  const { order, lanes, total, blocked, loaded, stale, redacted } = board

  if (!loaded && total === 0) {
    return <p className="sect-log__empty">Memuat amanat…</p>
  }

  if (total === 0) {
    return (
      <div className="sect-amanat">
        <p className="sect-log__empty">
          Belum ada amanat.
          <br />
          <span className="sect-amanat__hint">
            Papan ini terisi saat gateway mengirim <code>task_update</code>.
            Lihat <code>bridges/hermes-emit</code>.
          </span>
        </p>
      </div>
    )
  }

  return (
    <div className="sect-amanat">
      <div className="sect-amanat__strip">
        <span className="sect-amanat__total">{total} amanat</span>
        {blocked > 0 && (
          <span className="sect-amanat__alert">{blocked} menunggu Anda</span>
        )}
        {redacted && <span className="sect-amanat__veil">judul disembunyikan</span>}
        {stale && <span className="sect-amanat__stale">tak tersambung</span>}
      </div>

      {order.map((id) => (
        <Lane key={id} id={id} tasks={lanes[id]} now={now} />
      ))}
    </div>
  )
}
