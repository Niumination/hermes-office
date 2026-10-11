/**
 * Tenaga — the qi ring.
 *
 * Burn as a cultivator's circulating qi, not a progress bar. The ring is the
 * product's single most important number (how close the fleet is to its spend
 * limit), so it gets the only continuously-animated element in the chrome and
 * the only use of the deviation hue.
 *
 * Five states, from the policy: normal / warm / hot / critical / tripped.
 * salah jalan — "qi deviation" — is the tripped state, and it is the one moment
 * the UI is allowed to look alarmed.
 */
import React from 'react'
import type { BurnState, BurnSnapshot } from '../hermes/burnTypes'
import { QI_NAMES } from '../theme/sect'

const QI_VAR: Record<BurnState, string> = {
  normal: 'var(--sect-qi-0)',
  warm: 'var(--sect-qi-1)',
  hot: 'var(--sect-qi-2)',
  critical: 'var(--sect-qi-3)',
  tripped: 'var(--sect-qi-4)',
}

const R = 15
const C = 2 * Math.PI * R

export const QiRing: React.FC<{
  state: BurnState
  snapshot: BurnSnapshot | null
}> = ({ state, snapshot }) => {
  const g = snapshot?.global
  // Three different situations that a single "— — —" used to flatten into one:
  //
  //   redacted  — a guest; the server removed the figures, so there is nothing
  //               to show and pretending otherwise would be a fabrication.
  //   unbounded — an owner with no hourly limit configured. The SPEND is known
  //               ($1.25), only the proportion is not. Blanking it hid a real
  //               number behind a privacy state it was never in.
  //   bounded   — spend and limit both known; the ring is a true proportion.
  const redacted = Boolean(g?.redacted)
  const spent = g?.spentHourUsd ?? null
  const limit = g?.limitHourUsd ?? null
  const bounded = !redacted && g?.ratio != null && limit != null
  const ratio = bounded ? Math.max(0, Math.min(1, g!.ratio!)) : 0
  const qi = QI_VAR[state]

  return (
    <div
      className="sect-stat"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      title={
        redacted ? 'Anggaran diredaksi untuk tamu'
          : bounded ? `${Math.round(ratio * 100)}% dari pagu jam ini`
          : 'Belanja diketahui; pagu per jam belum dikonfigurasi'
      }
    >
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle
          cx="19" cy="19" r={R}
          fill="none"
          stroke="var(--sect-ink-4)"
          strokeWidth="2.5"
        />
        <circle
          cx="19" cy="19" r={R}
          fill="none"
          stroke={qi}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={bounded ? `${ratio * C} ${C}` : `2 6`}
          transform="rotate(-90 19 19)"
          style={{
            filter: `drop-shadow(0 0 5px ${qi})`,
            transition: 'stroke-dasharray 600ms var(--sect-ease), stroke 400ms var(--sect-ease)',
            opacity: bounded ? 1 : 0.55,
          }}
        />
      </svg>
      <div>
        <div className="han" style={{ fontSize: 'var(--sect-t-sm)', color: qi, lineHeight: 1.2 }}>
          {QI_NAMES[state].nameId}
        </div>
        <div className="figure" style={{ fontSize: 'var(--sect-t-xs)', color: 'var(--sect-mist)' }}>
          {redacted ? 'Tamu · diredaksi'
            : spent == null ? '—'
            : bounded ? `$${spent.toFixed(2)} / $${limit!.toFixed(2)}`
            : `$${spent.toFixed(2)} · tanpa pagu`}
        </div>
      </div>
    </div>
  )
}

export default QiRing
