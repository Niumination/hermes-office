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
  state: 'working' | 'idle' | 'away'
  qi: BurnState
}

const QI_VAR: Record<BurnState, string> = {
  normal: 'var(--sect-qi-0)',
  warm: 'var(--sect-qi-1)',
  hot: 'var(--sect-qi-2)',
  critical: 'var(--sect-qi-3)',
  tripped: 'var(--sect-qi-4)',
}

export const Hall: React.FC<{
  room: RoomId
  hall: SectHall | undefined
  plate: string
  locked: boolean
  guest?: boolean
  cultivators: Cultivator[]
}> = ({ room, hall, plate, locked, guest, cultivators }) => {
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
            cultivators.map((c) => (
              <figure
                key={c.id}
                className={`sect-cul sect-cul--${c.state}`}
                style={{ ['--qi' as string]: QI_VAR[c.qi] }}
                title={c.task ? `${c.name} — ${c.task}` : c.name}
              >
                <div className="sect-cul__aura">
                  <span className="sect-cul__glyph">{c.glyph}</span>
                </div>
                <figcaption className="sect-cul__name">{c.name}</figcaption>
                {c.task && <p className="sect-cul__task">{c.task}</p>}
              </figure>
            ))
          )}
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
