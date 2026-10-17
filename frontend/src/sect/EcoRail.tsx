/**
 * EcoRail — the rooms of one workplace, and the switch between workplaces.
 *
 * This replaces RealmRail, which ranked eight inherited rooms by hourly budget
 * and called the ordering a mountain. The ordering was real; the rooms were
 * not. They came from the `W17ant/Claude-Office` fork — a lobby, a kitchen, a
 * nap room — and no amount of correct sorting makes a kitchen appear in an
 * ecosystem that has none.
 *
 * What replaces it is not a better ranking. It is a different question. The
 * rail no longer asks "how expensive is this hall"; it asks "where does the
 * owner keep their work", and the answer is read from the owner's own
 * filesystem: twelve root folders on the Mac, three groupings on LightVela.
 *
 * TWO OFFICES, ONE AT A TIME
 * --------------------------
 * The owner works in two places and asked to switch between them rather than
 * see both at once. That is also the only way the rooms stay legible: fifteen
 * rooms side by side would be a list, not a floor.
 *
 * WHAT THE COUNTS MEAN
 * --------------------
 * The number beside a room is how many desks it holds — a fact from the
 * ecosystem model, true whether or not a server is reachable. It is NOT an
 * occupancy count. When presence is wired up, occupancy will be drawn
 * separately and absence will read as "not known", never as zero. Conflating
 * the two is exactly how this office once showed `MURID 0` while the server
 * was answering 401.
 */
import React from 'react'
import {
  OFFICES, OFFICE_ORDER, roomsOf, desksOf,
  type OfficeId,
  roomRef,
} from '../eco/ecosystem'

export const EcoRail: React.FC<{
  office: OfficeId
  room: string
  onOffice: (o: OfficeId) => void
  onEnter: (room: string) => void
  /** Live occupants per room id, when a session has supplied them. */
  occupancy?: Record<string, number>
}> = ({ office, room, onOffice, onEnter, occupancy }) => {
  const rooms = roomsOf(office)

  return (
    <nav className="sect-rail eco-rail-floor" aria-label="Ruang kerja">
      <div className="eco-rail-floor__switch" role="tablist" aria-label="Pilih kantor">
        {OFFICE_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === office}
            className={`eco-rail-floor__office${id === office ? ' is-on' : ''}`}
            onClick={() => onOffice(id)}
            title={OFFICES[id].purpose}
          >
            <span aria-hidden="true">{OFFICES[id].icon}</span>
            {OFFICES[id].label}
          </button>
        ))}
      </div>

      <p className="eco-rail-floor__host">
        <code>{OFFICES[office].root}</code>
      </p>

      <ul className="eco-rail-floor__list">
        {rooms.map((r) => {
          const desks = desksOf(office, r.id)
          // `undefined` and `0` are different answers and are drawn
          // differently: no session means unknown, not empty.
          // Keyed by ecosystem reference, because `root` exists in both
          // offices and a bare id cannot tell them apart. Reading it with
          // `r.id` meant the lookup always missed and this badge could never
          // appear, however busy the room was.
          const here = occupancy?.[roomRef(office, r.id)]
          return (
            <li key={r.id}>
              <button
                type="button"
                className={[
                  'eco-rail-floor__room',
                  r.id === room ? 'is-here' : '',
                  r.isRoot ? 'is-root' : '',
                ].filter(Boolean).join(' ')}
                aria-current={r.id === room ? 'true' : undefined}
                onClick={() => onEnter(r.id)}
              >
                <span className="eco-rail-floor__icon" aria-hidden="true">{r.icon}</span>
                <span className="eco-rail-floor__name">{r.label}</span>
                {here !== undefined && here > 0 && (
                  <span className="eco-rail-floor__here" title={`${here} di ruangan ini`}>
                    {here}
                  </span>
                )}
                <span className="eco-rail-floor__desks" title={`${desks.length} meja`}>
                  {desks.length}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="eco-rail-floor__legend">
        Angka = jumlah meja di ruangan, bukan jumlah penghuni.
      </p>
    </nav>
  )
}

export default EcoRail
