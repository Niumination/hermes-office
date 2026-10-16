/**
 * cast — which donghua archetype stands in for an agent, and which way it faces.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * It exists because it was deleted. The Sect migration replaced the sprite
 * stage with a two-letter mark in a qi ring, and on 2026-10-12 commit 5b90097
 * retired 132 orphaned sprites on the evidence that nothing referenced them.
 * That evidence was true and the conclusion was wrong: the sprites were not
 * surplus, their reader had been dropped. The art was preserved precisely so
 * the decision could be reversed. This is the reversal.
 *
 * WHAT IS A FACT AND WHAT IS DECORATION
 * -------------------------------------
 * The archetype is a FACT about the agent: it comes from the agent's id, or
 * failing that from the role the server reports in /roster. Two agents with
 * the same role look alike because they ARE alike; that is information, not a
 * collision.
 *
 * The facing encodes one fact and one non-fact, and they must not be confused:
 *   - front vs rear is a FACT. An agent that has gone quiet is drawn from
 *     behind. It is a second rendering of the same `state` the CSS class
 *     already carries, not a new claim.
 *   - left vs right is DECORATION. It is a hash of the id, stable so a
 *     character never flips between renders, and it means nothing whatsoever.
 *     A crowd of identical poses reads as a rendering bug; this is the cheapest
 *     fix that invents no information.
 *
 * A ghost — an agent on the roster that has never once been seen — is drawn
 * front-facing on purpose. Drawing its back would say it was here and left,
 * which is the one thing we know is false.
 */

/** The eight archetypes built by scripts/build-cast-sprites.py. */
export type Archetype =
  | 'cultivator' | 'weaver' | 'forge' | 'guardian'
  | 'scholar' | 'alchemist' | 'physician' | 'elder'

export const ARCHETYPES: readonly Archetype[] = [
  'cultivator', 'weaver', 'forge', 'guardian',
  'scholar', 'alchemist', 'physician', 'elder',
] as const

/**
 * Named agents this office actually runs. Keyed by id because identity beats
 * role: `boss` reports role "reviewer", but the Balai Sesepuh is his hall and
 * drawing the sect head as a junior scholar would be a worse answer than the
 * role lookup gives.
 */
const BY_ID: Record<string, Archetype> = {
  boss: 'elder',        // Ketua — Balai Sesepuh
  cloud: 'cultivator',  // Awan — the generalist that does the work
  mac: 'alchemist',     // Alat — Bilik Ramuan is the mac-studio
  octo: 'forge',
  github: 'forge',
  'cron-runner': 'physician',
  debugger: 'physician',
  'code-reviewer': 'scholar',
  'frontend-developer': 'weaver',
  'fullstack-developer': 'cultivator',
  'test-engineer': 'alchemist',
  'security-auditor': 'guardian',
}

/**
 * Role → archetype. These are the pairings build-cast-sprites.py already
 * records as the reason each archetype was generated; duplicating them by
 * hand here would let the two drift, so the names match that script exactly.
 */
const BY_ROLE: Record<string, Archetype> = {
  fullstack: 'cultivator',
  generalist: 'cultivator',
  default: 'cultivator',
  frontend: 'weaver',
  devops: 'forge',
  security: 'guardian',
  reviewer: 'scholar',
  tester: 'alchemist',
  debugger: 'physician',
  manager: 'elder',
}

/** Stable, well-spread hash. Only ever used to pick a side to face. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0)
}

/** The archetype for an agent. Never throws, always returns something. */
export function archetypeFor(id: string, role?: string): Archetype {
  const byId = BY_ID[id]
  if (byId) return byId
  if (role) {
    const byRole = BY_ROLE[role.toLowerCase()]
    if (byRole) return byRole
  }
  // Unknown agent, unknown role. Spread them over the cast rather than piling
  // every stranger onto one archetype, so a fleet of unnamed workers still
  // reads as a crowd of people.
  return ARCHETYPES[hash(id) % ARCHETYPES.length]
}

/**
 * The sprite URL for an agent in a given state.
 *
 * `away` turns the character around; everything else faces the hall. The
 * left/right side is fixed per agent and carries no meaning (see header).
 */
export function spriteFor(
  id: string,
  state: 'working' | 'idle' | 'away' | 'ghost',
  role?: string,
): string {
  const archetype = archetypeFor(id, role)
  const depth = state === 'away' ? 'rear' : 'front'
  const side = hash(id) % 2 === 0 ? 'left' : 'right'
  return `/sprites/donghua/${archetype}-${depth}-${side}.webp`
}
