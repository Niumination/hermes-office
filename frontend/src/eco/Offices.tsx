import { useState } from 'react'
import {
  OFFICES, OFFICE_ORDER, roomsOf, desksOf, agentsOf,
  placeAgent, describePlacement,
  type OfficeId, type EcoDesk, type EcoAgent,
} from './ecosystem'
import './offices.css'

/**
 * Offices — two workplaces, one at a time.
 *
 * The owner switches between them rather than seeing both at once, which is
 * what lets a room breathe: the Mac has twelve rooms and LightVela three, and
 * side by side neither would be legible.
 *
 * WHAT THIS VIEW REFUSES TO DO
 * ----------------------------
 * It will not draw a number it was not given. There is no server attached to
 * this preview, so it draws the structure (which is a fact, transcribed from
 * the owner's repositories) and says plainly that presence is not connected
 * yet. The failure it is written against is already on record: a signed-out
 * viewer was shown `MURID 0` and `AMANAT 0` while the server answered 401
 * eleven times. Absent is not zero.
 */

/** Placements the owner stated by name. Everything else is honestly unplaced. */
const STATED: ReadonlyArray<[string, string]> = [
  ['mac/utama', 'mirai'],
  ['lightvela/utama', 'hermes-office'],
]

function placementsFor(office: OfficeId): Map<string, EcoAgent> {
  const out = new Map<string, EcoAgent>()
  for (const [agentId, deskId] of STATED) {
    const p = placeAgent(agentId, deskId)
    if (p && p.agent.office === office) out.set(p.desk.id, p.agent)
  }
  return out
}

function Desk({ desk, seated }: { desk: EcoDesk; seated?: EcoAgent }) {
  const cls = [
    'eco-desk',
    desk.private ? 'eco-desk--private' : '',
    seated ? 'eco-desk--seated' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cls} data-desk={desk.id}>
      <div className="eco-desk__top">
        <span className="eco-desk__name">{desk.label}</span>
        {desk.private && <span className="eco-desk__lock" title="repo privat — isinya tidak pernah dibaca">🔒</span>}
        {desk.port !== undefined && <span className="eco-desk__port">:{desk.port}</span>}
      </div>
      {desk.note && <p className="eco-desk__note">{desk.note}</p>}
      {desk.private && (
        <p className="eco-desk__sealed">
          Privat. Mejanya ada, isinya tidak ditampilkan.
        </p>
      )}
      {seated ? (
        <div className="eco-desk__seat">
          <span className="eco-seat__dot" aria-hidden="true" />
          <span className="eco-seat__name">{seated.label}</span>
          {seated.pinnedDesk && <span className="eco-seat__pin" title="agen terpaku — hanya meja ini">📌</span>}
        </div>
      ) : (
        <div className="eco-desk__seat eco-desk__seat--empty">
          <span className="eco-seat__name">belum ada penempatan</span>
        </div>
      )}
    </div>
  )
}

export default function Offices() {
  const [office, setOffice] = useState<OfficeId>('mac')
  const o = OFFICES[office]
  const rooms = roomsOf(office)
  const agents = agentsOf(office)
  const seatedBy = placementsFor(office)
  const seatedAgents = new Set([...seatedBy.values()].map((a) => a.id))

  return (
    <div className="eco-app">
      <header className="eco-top">
        <nav className="eco-switch" role="tablist" aria-label="Pilih kantor">
          {OFFICE_ORDER.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === office}
              className={`eco-switch__tab${id === office ? ' is-on' : ''}`}
              onClick={() => setOffice(id)}
            >
              <span className="eco-switch__icon">{OFFICES[id].icon}</span>
              {OFFICES[id].label}
            </button>
          ))}
        </nav>
        <div className="eco-top__meta">
          <code>{o.host}</code>
          <span className="eco-sep">·</span>
          <code>{o.tailscale}</code>
          <span className="eco-sep">·</span>
          <code>{o.root}</code>
        </div>
      </header>

      <p className="eco-purpose">{o.purpose}</p>

      <div className="eco-banner">
        <b>Pratinjau tata letak.</b> Belum tersambung ke server, jadi kehadiran agen
        belum diketahui — dan halaman ini tidak menebaknya. Dua penempatan di bawah
        adalah yang Anda sebutkan sendiri; sisanya ditulis apa adanya sebagai
        “belum ada penempatan”, bukan nol.
      </div>

      <div className="eco-cols">
        <main className="eco-floor">
          {rooms.map((room) => {
            const desks = desksOf(office, room.id)
            return (
              <section
                key={room.id}
                className={`eco-room${room.isRoot ? ' eco-room--root' : ''}`}
              >
                <header className="eco-room__head">
                  <span className="eco-room__icon">{room.icon}</span>
                  <h2 className="eco-room__name">{room.label}</h2>
                  {room.isRoot && <span className="eco-room__badge">akar</span>}
                  <code className="eco-room__path">{room.path}</code>
                  <span className="eco-room__count">
                    {desks.length} meja
                  </span>
                </header>
                {room.note && <p className="eco-room__note">{room.note}</p>}
                {desks.length > 0 ? (
                  <div className="eco-room__desks">
                    {desks.map((d) => (
                      <Desk key={d.id} desk={d} seated={seatedBy.get(d.id)} />
                    ))}
                  </div>
                ) : (
                  <p className="eco-room__empty">Ruangan ini belum punya meja terdaftar.</p>
                )}
              </section>
            )
          })}
        </main>

        <aside className="eco-rail">
          <h3 className="eco-rail__title">
            Agen {o.label}
            <span className="eco-rail__n">{agents.length}</span>
          </h3>
          <p className="eco-rail__sub">
            Satu agen = satu topik Telegram.
            {office === 'mac' && <> Id topik dari <code>topics.json</code>.</>}
            {office === 'lightvela' && <> Id topik belum terbaca — dicatat kosong, bukan dikarang.</>}
          </p>
          <ul className="eco-rail__list">
            {agents.map((a) => (
              <li
                key={a.id}
                className={`eco-agent${a.primary ? ' eco-agent--primary' : ''}${seatedAgents.has(a.id) ? ' is-seated' : ''}`}
              >
                <span className="eco-agent__name">{a.label}</span>
                {a.primary && <span className="eco-agent__tag">utama</span>}
                {a.pinnedDesk && (
                  <span className="eco-agent__tag eco-agent__tag--pin" title={`terpaku ke ${a.pinnedDesk}`}>
                    📌 {a.pinnedDesk}
                  </span>
                )}
                <span className="eco-agent__topic">
                  {a.topicId !== null ? `#${a.topicId}` : a.primary ? 'inbox' : '—'}
                </span>
              </li>
            ))}
          </ul>

          <div className="eco-rail__says">
            <h4>Kalimat yang harus benar</h4>
            {STATED.map(([agentId, deskId]) => {
              const p = placeAgent(agentId, deskId)
              if (!p || p.agent.office !== office) return null
              return <p key={agentId} className="eco-says">{describePlacement(p)}</p>
            })}
            {![...STATED].some(([a]) => a.startsWith(office)) && (
              <p className="eco-says eco-says--none">belum ada untuk kantor ini</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
