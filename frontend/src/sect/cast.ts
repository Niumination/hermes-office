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
 * Agents this office can actually name, keyed by id because identity beats
 * role: `boss` reports role "reviewer", and drawing the person who runs the
 * place as a junior scholar would be a worse answer than the role lookup
 * gives. The hall that used to justify this — Balai Sesepuh — was a fork
 * invention and is gone; the identity argument is what survives it.
 *
 * SEVEN NAMES REMOVED
 * -------------------
 * `cron-runner`, `debugger`, `code-reviewer`, `frontend-developer`,
 * `fullstack-developer`, `test-engineer` and `security-auditor` used to sit
 * in this table. None of them appears anywhere in server/ or tests/ — not
 * once. They are MIRAI's generic profile names, and the owner's own
 * topics.json carries the warning in advance: "Nilai bukan
 * research/writer/developer generik MIRAI". A lookup table full of agents
 * that cannot arrive is not harmless: it reads like evidence that this fleet
 * has a frontend developer and a security auditor, and it does not.
 *
 * What the server can really send is small and knowable. /roster returns
 * PERMANENT_CAST — cloud, mac, boss — plus whatever has sent a heartbeat.
 */
const BY_ID: Record<string, Archetype> = {
  // The permanent cast, verbatim from server/index.js.
  boss: 'elder',        // Ketua — the owner of the office
  cloud: 'cultivator',  // Awan — the generalist that does the work
  mac: 'alchemist',     // Alat — the Mac workstation

  // Sources that can also arrive as heartbeat names.
  github: 'forge',
  octo: 'forge',
  system: 'physician',

  /*
    The Telegram topics, which are what an "agent" means in this ecosystem:
    kantor → ruang → meja → agen = mesin → kategori → repo → topik telegram.

    THESE KEYS WERE WRONG, AND THE FAILURE WAS SILENT
    -------------------------------------------------
    They used to be spelled `lightvela/infra`, `mac/qa`, and so on — the
    office/room form. No bridge has ever emitted that. `_slug()` in
    bridges/hermes-cloud-hook/handler.py prefixes the topic name and sends
    `lv-infra`. So every lookup here missed, every agent fell through to the
    role table below, and all five LightVela agents resolved to one single
    file: cultivator-front-left.webp.

    Nothing threw. The office just drew the same character five times — which
    is precisely the bug this whole line of work exists to kill: a fleet
    rendered as one worker. A lookup table cannot report its own miss, so the
    miss has to be found from outside, by scripts/check-cast-ids.py.

    The ten mac/* keys are deleted rather than re-spelled. There is no Mac
    topic hook yet, so every id written here today would be a guess, and this
    file's own history is a record of what guessed-ahead tables cost. The gate
    fails the build the moment a bridge can emit a name this table does not
    know, so it grows on evidence instead of ahead of it.

    Room-mates must not collide: two identical figures standing side by side
    read as a rendering fault even when the attribution underneath is correct.
    The gate checks that too, against the home map in docs/POLICY.md.
  */
  'lv-utama': 'elder',           // main chat / DM — speaks for the machine
  'lv-general': 'scholar',       // topic 1
  'lv-infra': 'physician',       // topic 55 — keeps the services healthy
  'lv-studio': 'weaver',         // topic 838
  'lv-contentvela': 'alchemist', // topic 5 — the contentvela repo
}

/**
 * Role → archetype, for an agent this file cannot name.
 *
 * Only two roles can ever arrive. server/index.js hands /roster the permanent
 * cast with roles "generalist" and "reviewer", and labels every heartbeat it
 * discovers "generalist". There is no third path.
 *
 * SEVEN ROLES REMOVED: fullstack, default, frontend, devops, security, tester,
 * debugger, manager. Every one was unreachable — a branch that had never run
 * and never could. They came from the same MIRAI profile vocabulary as the
 * deleted ids, and they made this table look like it was describing a staffed
 * organisation instead of three agents. If the server starts reporting a new
 * role, the fallback below already handles it and this table can grow on
 * evidence rather than ahead of it.
 */
const BY_ROLE: Record<string, Archetype> = {
  generalist: 'cultivator',
  reviewer: 'scholar',
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
