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
import type { Archetype } from './cast'
import { placeAll } from './stations'

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
  /**
   * Which station on the floor this disciple occupies (sect/stations.ts).
   * Optional for the same reason `sprite` is: without it the figure falls
   * back to the shared station rather than vanishing.
   */
  archetype?: Archetype
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
const Disciple: React.FC<{
  c: Cultivator
  /**
   * Floor placement. Absent for the ghost strip, which is deliberately NOT on
   * the floor — those agents have no station because the server placed them
   * nowhere, and giving them one would re-tell the lie the floor plan exists
   * to stop telling.
   */
  placed?: { station: { x: number; y: number }; scale: number; z: number }
}> = ({ c, placed }) => {
  const [failed, setFailed] = React.useState(false)
  const showSprite = Boolean(c.sprite) && !failed
  return (
      <figure
        className={`sect-cul sect-cul--${c.state}${showSprite ? ' sect-cul--art' : ''}${
          placed ? ' sect-cul--placed' : ''
        }`}
        style={{
          ['--qi' as string]: QI_VAR[c.qi],
          ...(placed
            ? {
                left: `${placed.station.x}%`,
                top: `${placed.station.y}%`,
                ['--cul-scale' as string]: placed.scale,
                zIndex: placed.z,
              }
            : null),
        }}
          title={c.task ? `${c.name} — ${c.task}` : c.name}
          aria-label={placed ? (c.task ? `${c.name} — ${c.task}` : c.name) : undefined}
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
        {/* A placed disciple carries no caption of its own: the nameplate
            layer draws the name once, above every figure. Rendering it here
            too would put the same name in the document twice — a stutter for
            a screen reader, and ambiguity for a test. The figure keeps an
            accessible name through aria-label instead. */}
        {!placed && <figcaption className="sect-cul__name">{c.name}</figcaption>}
        {!placed && c.task && <p className="sect-cul__task">{c.task}</p>}
      </figure>
  )
}

export const Hall: React.FC<{
  // A room id from the ecosystem model, so this is a plain string: the fork's
  // RoomId union no longer describes any place the owner actually works.
  room: string
  hall: SectHall | undefined
  plate: string
  locked: boolean
  /**
   * False when the office refused to say who is here — no session, so
   * `/policy occupants` answered 401 and the floor plan is unread.
   *
   * An empty court and an unread court are not the same claim, and this
   * screen used to make the second one look like the first: signed out, it
   * drew "Balai kosong" over an office it had never been allowed to see.
   * MIRAI's roster already had the word for this state and called it
   * `unreachable` — "a seat whose files cannot be read is unreachable, never
   * an exception". Hermes Office had no such word, so it reached for zero.
   */
  occupancyKnown: boolean
  cultivators: Cultivator[]
  /**
   * Agents the roster lists that the server has placed nowhere. Drawn in
   * their own strip, never mixed into the court: the court is the server's
   * floor plan and these are absent from it. Mixing them in would re-tell
   * the exact lie the floor plan was fixed to stop telling.
   */
  ghosts?: Cultivator[]
}> = ({ room, hall, plate, locked, occupancyKnown, cultivators, ghosts = [] }) => {
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
            {!occupancyKnown ? (
              <p className="sect-court__unknown sect-script">
                Tidak diketahui
                <small>Belum masuk — kantor tidak menjawab siapa yang ada di sini</small>
              </p>
            ) : cultivators.length === 0 ? (
              <p className="sect-court__empty sect-script">Balai kosong</p>
            ) : (
            // placeAll returns back-to-front, so painting in order gives
            // correct overlap without any per-figure z juggling here.
            placeAll(cultivators).map((c) => (
              <Disciple
                key={c.id}
                c={c}
                placed={{ station: c.station, scale: c.scale, z: c.z }}
              />
            ))
          )}

          {/* Nameplates ride in their own layer above every figure.
              Inside the figure they inherited that figure's depth, so a
              disciple standing in front cropped the name of the one behind
              — `code-reviewer` read as `e-reviewer`. Bodies still occlude
              each other by depth; only the captions float clear. */}
          {cultivators.length > 0 && (
            <div className="sect-court__plates" aria-hidden="true">
              {placeAll(cultivators).map((c) => (
                <span
                  key={c.id}
                  className="sect-court__plate"
                  style={{ left: `${c.station.x}%`, top: `${c.station.y}%` }}
                >
                  {c.name}
                </span>
              ))}
            </div>
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
