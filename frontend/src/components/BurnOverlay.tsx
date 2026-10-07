/**
 * BurnOverlay — burn rate rendered as room physics.
 *
 * The office floor is the chart. Spend against budget drives temperature:
 * the room warms, then glows, then catches fire, and when the circuit breaker
 * trips the sprinklers come on. A number in a dashboard is ignorable; a room
 * on fire is not.
 *
 * States come straight from the server's budget ladder (server/burnrate.js):
 *   normal → warm → hot → critical → tripped
 *
 * Self-contained on purpose: it polls GET /burn rather than threading burn
 * state through the whole component tree, so it can be dropped into any room
 * view without a refactor.
 */
import React, { useState } from 'react'

export type BurnState = 'normal' | 'warm' | 'hot' | 'critical' | 'tripped'

export interface BurnSnapshot {
  global: {
    spentHourUsd: number
    spentDayUsd: number
    limitHourUsd: number | null
    limitDayUsd: number | null
    ratio: number | null
    state: BurnState
    lifetimeUsd: number
    redacted?: boolean
  }
  agents: Array<{
    agent: string
    spentHourUsd: number
    limitUsd: number | null
    ratio: number | null
    state: BurnState
    calls: number
    tokens: number
  }>
}

const TINT: Record<BurnState, string> = {
  normal: 'transparent',
  warm: 'rgba(255, 176, 59, 0.10)',
  hot: 'rgba(255, 115, 32, 0.20)',
  critical: 'rgba(255, 46, 20, 0.30)',
  tripped: 'rgba(120, 190, 255, 0.26)',
}

const LABEL: Record<BurnState, string> = {
  normal: 'nominal',
  warm: 'warming',
  hot: 'hot',
  critical: 'CRITICAL',
  tripped: 'BREAKER TRIPPED',
}

const usd = (n: number) =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`

/** Deterministic per-index offsets so particles don't all move in lockstep. */
const spread = (i: number, n: number) => ((i + 0.5) / n) * 100

/**
 * The snapshot arrives as a prop from useBurnState rather than being fetched
 * here. This component used to poll /burn on a 3 s timer while OfficeStage
 * polled the same endpoint on a 5 s timer, so the HUD and the room lighting
 * could disagree about the state for seconds at a time.
 */
export const BurnOverlay: React.FC<{ snapshot: BurnSnapshot | null }> = ({ snapshot }) => {
  const snap = snapshot
  const [expanded, setExpanded] = useState(false)


  // No budget configured → the feature stays completely out of the way.
  if (!snap || snap.global.limitHourUsd == null) return null

  const { state, spentHourUsd, limitHourUsd, ratio } = snap.global
  // Guests get state and ratio but zeroed amounts; show the temperature
  // without inventing a dollar figure that is not theirs to see.
  const redacted = snap.global.redacted === true
  const pct = Math.min(100, Math.round((ratio ?? 0) * 100))
  const onFire = state === 'critical'
  const tripped = state === 'tripped'

  const hottest = snap.agents.filter(a => a.state !== 'normal').slice(0, 4)

  return (
    <div className="burn-layer" aria-hidden={false}>
      {/* Heat tint over the whole room */}
      <div
        className={`burn-tint burn-${state}`}
        style={{ background: TINT[state] }}
        data-testid="burn-tint"
      />

      {/* Flames lick up from the floor once spend is critical */}
      {onFire && (
        <div className="burn-flames" data-testid="burn-flames">
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className="burn-flame"
              style={{ left: `${spread(i, 7)}%`, animationDelay: `${i * 0.17}s` }}
            >
              🔥
            </span>
          ))}
        </div>
      )}

      {/* Breaker tripped: sprinklers. Spend is halted, work is being cooled. */}
      {tripped && (
        <div className="burn-sprinklers" data-testid="burn-sprinklers">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              className="burn-drop"
              style={{ left: `${spread(i, 18)}%`, animationDelay: `${(i % 6) * 0.13}s` }}
            />
          ))}
        </div>
      )}

      {/* HUD */}
      <button
        type="button"
        className={`burn-hud burn-hud-${state}`}
        data-testid="burn-hud"
        onClick={() => setExpanded(v => !v)}
        title="Burn rate against the hourly budget — click for per-agent detail"
      >
        <span className="burn-hud-top">
          <span className="burn-hud-dot" />
          <span className="burn-hud-state">{LABEL[state]}</span>
          <span className="burn-hud-amount">
            {redacted ? (
              <>{pct}<span className="burn-hud-per">% of budget</span></>
            ) : (
              <>
                {usd(spentHourUsd)} <span className="burn-hud-of">of</span> {usd(limitHourUsd)}
                <span className="burn-hud-per">/hr</span>
              </>
            )}
          </span>
        </span>

        <span className="burn-hud-bar">
          <span className="burn-hud-fill" style={{ width: `${pct}%` }} />
        </span>

        {expanded && !redacted && (
          <span className="burn-hud-detail">
            {hottest.length === 0 ? (
              <span className="burn-hud-row burn-hud-quiet">all agents within budget</span>
            ) : (
              hottest.map(a => (
                <span key={a.agent} className={`burn-hud-row burn-row-${a.state}`}>
                  <span className="burn-row-name">{a.agent}</span>
                  <span className="burn-row-spend">
                    {usd(a.spentHourUsd)}
                    {a.limitUsd != null && ` / ${usd(a.limitUsd)}`}
                  </span>
                </span>
              ))
            )}
            <span className="burn-hud-row burn-hud-quiet">
              today {usd(snap.global.spentDayUsd)}
              {snap.global.limitDayUsd != null && ` of ${usd(snap.global.limitDayUsd)}`}
            </span>
          </span>
        )}
      </button>
    </div>
  )
}

export default BurnOverlay
