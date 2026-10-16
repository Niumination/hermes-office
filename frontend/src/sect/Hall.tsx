/**
 * The hall — the stage.
 *
 * The old OfficeStage walked sprites between x/y waypoints on an isometric
 * floor. This does not. An agent is *present in a hall* or it is not; where it
 * stands inside the hall carries no information, so inventing coordinates for
 * it was 22 kB of code describing nothing.
 *
 * What the scene shows instead: which hall you are looking at, who is in it,
 * and what their qi is doing. Everything on screen is a fact from the event
 * stream or the policy.
 */
import React from 'react'
import type { RoomId } from '../rooms'
import type { SectHall } from '../theme/sect'
import type { BurnState } from '../hermes/burnTypes'

export interface Cultivator {
  id: string
  name: string
  glyph: string
  task?: string
  state: 'working' | 'idle' | 'away' | 'ghost'
  qi: BurnState
  /**
   * Character art from sect/cast.ts. Optional: absent means mark-only, which
   * is exactly how this component behaved before the cast came back.
   */
  sprite?: string
}

const QI_VAR: Record<BurnState, string> = {
  normal: 'var(--sect-qi-0)',
  warm: 'var(--sect-qi-1)',
  hot: 'var(--sect-qi-2)',
  critical: 'var(--sect-qi-3)',
  tripped: 'var(--sect-qi-4)',
}

/**
 * One disciple.
 *
 * A component rather than inline JSX because the sprite needs per-image
 * failure state. Sprites are static files served beside the bundle, so a
 * deploy that ships the JS and forgets the webp files would empty the
 * mountain a second time for a completely different reason. On error this
 * falls back to the mark, and the hall still reports who is in it.
 */
const Disciple: React.FC<{ c: Cultivator }> = ({ c }) => {
  const [failed, setFailed] = React.useState(false)
  const showSprite = Boolean(c.sprite) && !failed
  return (
    <figure
      className={`sect-cul sect-cul--${c.state}${showSprite ? ' sect-cul--art' : ''}`}
      style={{ ['--qi' as string]: QI_VAR[c.qi] }}
      title={c.task ? `${c.name} — ${c.task}` : c.name}
    >
      <div className="sect-cul__aura">
        {showSprite ? (
          <img
            className="sect-cul__art"
            src={c.sprite}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="sect-cul__glyph">{c.glyph}</span>
        )}
      </div>
      <figcaption className="sect-cul__name">{c.name}</figcaption>
      {c.task && <p className="sect-cul__task">{c.task}</p>}
    </figure>
  )
}

export const Hall: React.FC<{
  room: RoomId
  hall: SectHall | undefined
  plate: string
  locked: boolean
  guest?: boolean
  cultivators: Cultivator[]
  /**
   * Agents the roster lists that the server has placed nowhere. Drawn in
   * their own strip, never mixed into the court: the court is the server's
   * floor plan and these are absent from it. Mixing them in would re-tell
   * the exact lie the floor plan was fixed to stop telling.
   */
  ghosts?: Cultivator[]
}> = ({ room, hall, plate, locked, guest, cultivators, ghosts = [] }) => {
  return (
    <main className="sect-stage" aria-label={hall ? `${hall.nameId} — ${hall.nameEn}` : room}>
      <div
        key={room}
        className="sect-hall"
        style={{ backgroundImage: `url(${plate})` }}
        role="img"
        aria-label={hall?.nameEn ?? room}
      />
      <div className="sect-hall__cloud" aria-hidden="true" />
      <div className="sect-hall__cloud sect-hall__cloud--far" aria-hidden="true" />
      <div className="sect-hall__grade" aria-hidden="true" />
      <div className="sect-hall__vig" aria-hidden="true" />
      <div className="sect-hall__frame" aria-hidden="true" />

      {!locked && (
        <div className="sect-court">
          {cultivators.length === 0 ? (
            <p className="sect-court__empty sect-script">Balai kosong</p>
          ) : (
            cultivators.map((c) => <Disciple key={c.id} c={c} />)
          )}
        </div>
      )}

      {!locked && ghosts.length > 0 && (
        <div className="sect-court sect-court--ghosts">
          <p className="sect-court__label sect-script">
            Tercatat di daftar — belum pernah terlihat
          </p>
          <div className="sect-court__row">
            {ghosts.map((g) => <Disciple key={g.id} c={g} />)}
          </div>
        </div>
      )}

      {guest && !locked && (
        <p className="sect-hall__guest sect-script" title="Tamu: angka anggaran diredaksi oleh server">
          Tamu — angka diredaksi
        </p>
      )}

      <div className="sect-hall__plate">
        <h1 className="sect-hall__name sect-script">{hall?.nameId ?? room}</h1>
        <div className="sect-hall__meta">
          <div className="sect-hall__en">{hall?.nameEn ?? ''}</div>
          <div className="sect-hall__band">{hall?.band ?? ''}</div>
        </div>
      </div>

      {locked && (
        <div className="sect-veil" role="alert">
          <div>
            <p className="sect-veil__name">Lenyap di Balik Kabut</p>
            <p className="sect-veil__en">The cloud is too deep to see through</p>
            <p className="sect-veil__why">
              Aula ini di atas tataran Anda. Servernya menolak dengan 403 — tampilan
              ini tidak menyembunyikan data yang sudah dikirim, server memang
              tidak pernah mengirimkannya.
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

export default Hall
