import type { SectRung } from '../theme/sect'
import { canEnter } from '../theme/sect'

/**
 * SectLadder — the floor plan, drawn as a mountain.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Policy as floor plan" has been a product principle since Fase 3, but the
 * floor plan was a flat office: the permission tier was a number in a table
 * and the rooms sat side by side, so nothing about the picture told you that
 * the server room costs twenty times the lobby. This draws the tier as
 * altitude, which is the one encoding a reader does not have to be taught.
 *
 * The rungs come from `sectLadder(policy.rooms)`, so the order is the
 * policy's, never this component's.
 *
 * A rung above the viewer's tier is NOT dimmed — it is locked and unlabelled
 * beyond its name. The server already refuses a guest token on /ledger,
 * /dossier, /standup, /approvals and /replay, and the kiosk downgrades
 * itself; drawing a hall as "available but greyed" would promise access the
 * API will refuse.
 */

export interface SectLadderProps {
  rungs: SectRung[]
  /** Highest tier this viewer may enter. A guest sits at -1: nothing. */
  viewerTier: number
  currentRoom?: string
  onSelect?: (room: string) => void
  /**
   * Hide the dollar caps. Used for a guest, whose /policy is redacted and
   * carries no budget at all (SECURITY.md §3): a cap of $0 would read as
   * "free", which is the opposite of the truth, so the column is dropped
   * instead.
   */
  hideCaps?: boolean
}

export default function SectLadder({
  rungs,
  viewerTier,
  currentRoom,
  onSelect,
  hideCaps,
}: SectLadderProps) {
  // Summit first: the mountain reads top-down on screen.
  const ordered = [...rungs].reverse()

  return (
    <nav className="sect-ladder" aria-label="Aula sekte berdasarkan ketinggian">
      <ol className="sect-ladder__list">
        {ordered.map((rung) => {
          const open = canEnter(rung, viewerTier)
          const current = rung.room === currentRoom
          return (
            <li key={rung.room}>
              <button
                type="button"
                className="sect-ladder__rung"
                data-locked={open ? undefined : ''}
                aria-current={current ? 'true' : undefined}
                aria-disabled={open ? undefined : 'true'}
                onClick={() => open && onSelect?.(rung.room)}
              >
                {hideCaps
                  ? null
                  : <span className="sect-ladder__cap">
                      {rung.capUsd === 0 ? '—' : `$${rung.capUsd.toFixed(2)}`}
                    </span>}
                <span className="sect-ladder__node" aria-hidden="true" />
                <span className="sect-ladder__cn">{rung.hall.cn}</span>
                <span className="sect-ladder__en">{rung.hall.en}</span>
                {!open && (
                  <span className="sect-ladder__lock">
                    封<span className="sect-ladder__sr"> — di luar jangkauanmu</span>
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
