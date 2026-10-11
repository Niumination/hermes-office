/**
 * The burn contract — the shape `GET /burn` returns.
 *
 * These types used to live inside `components/BurnOverlay.tsx`, a rendering
 * component. Every consumer that only needed the *shape* therefore had to
 * import a React component to get it, which is how a dead view kept three
 * live modules tethered to it: deleting the overlay would have taken the
 * contract with it.
 *
 * States come straight from the server's budget ladder (server/burnrate.js):
 *   normal → warm → hot → critical → tripped
 */

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

/** The five states, in ladder order. Exported so a test can assert totality. */
export const BURN_STATES: readonly BurnState[] = [
  'normal', 'warm', 'hot', 'critical', 'tripped',
] as const
