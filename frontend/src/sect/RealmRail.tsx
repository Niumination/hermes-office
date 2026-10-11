/**
 * Tataran — the realm rail.
 *
 * Permission is altitude. Every hall the policy governs is a rung; the rung's
 * height comes from the policy's own `budgetHourlyUsd` and from nowhere else,
 * so a budget change moves the mountain and no second copy of the ordering can
 * drift out of sync.
 *
 * Read it bottom-to-top: Gerbang Gunung at the foot, Balai Sesepuh at the summit. That is why
 * the list is `flex-direction: column-reverse` rather than a reversed array —
 * the data stays in policy order, only the painting is inverted.
 */
import React from 'react'
import type { PolicySnapshot } from '../theme/policyClient'
import type { RoomId } from '../rooms'

export const RealmRail: React.FC<{
  ladder: PolicySnapshot | null
  current: RoomId
  occupancy: Record<string, number>
  onEnter: (room: RoomId) => void
}> = ({ ladder, current, occupancy, onEnter }) => {
  const rungs = ladder?.rungs ?? []
  const viewerTier = ladder?.viewerTier ?? -1
  const redacted = Boolean(ladder?.redacted)

  return (
    <nav className="sect-rail" aria-label="Tataran — tingkatan aula">
      <div className="sect-rail__head">
        <div className="sect-rail__title sect-script">Tataran</div>
        <div className="sect-rail__gloss">realm · izin = ketinggian</div>
      </div>

      <div className="sect-rungs">
        {rungs.length === 0 && (
          <div className="sect-log__empty">Tata letak belum dimuat.</div>
        )}

        {rungs.map((r) => {
          const locked = r.tier > viewerTier
          const here = r.room === current
          const n = occupancy[r.room] ?? 0
          return (
            <button
              key={r.room}
              type="button"
              className="sect-rung"
              aria-current={here}
              disabled={locked}
              onClick={() => onEnter(r.room)}
              title={locked ? 'Lenyap di Balik Kabut — tidak boleh masuk' : r.hall.nameEn}
            >
              <span className="sect-rung__alt">{'·'.repeat(r.tier + 1)}</span>

              <span style={{ minWidth: 0 }}>
                <span className="sect-rung__name">{r.hall.nameId}</span>
                <span className="sect-rung__en" style={{ display: 'block' }}>
                  {r.hall.nameEn}
                </span>
                {n > 0 && (
                  <span className="sect-rung__who" aria-label={`${n} di aula ini`}>
                    {Array.from({ length: Math.min(n, 6) }, (_, i) => <i key={i} />)}
                  </span>
                )}
              </span>

              <span className="sect-rung__cap">
                {locked ? <span className="sect-rung__lock">Kunci</span>
                  : redacted ? '—'
                  : r.capUsd > 0 ? `$${r.capUsd}` : '·'}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default RealmRail
