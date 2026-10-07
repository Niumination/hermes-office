/**
 * config.ts — Hermes Office shared configuration constants.
 *
 * Boss settings can be customised via office.config.json in the frontend root
 * (optional; falls back to sane defaults).
 */

import officeConfig from '../office.config.json'

const userConfig = officeConfig as {
  boss?: { name?: string; sprite?: string; color?: string; emoji?: string }
}

const bossName   = userConfig.boss?.name   ?? 'Afrizal'
const bossSprite = userConfig.boss?.sprite ?? 'Me-1'
const bossColor  = userConfig.boss?.color  ?? '#ff4444'
const bossEmoji  = userConfig.boss?.emoji  ?? '👑'

export const BOSS_CHAR = bossSprite
export const BOSS_ROLE = 'boss'
export const BOSS_NAME = bossName
export const BOSS_COLOR = bossColor
export const BOSS_EMOJI = bossEmoji

// Map agent roles → donghua archetype sprites (in /sprites/donghua/).
// UI-SPEC.md §2 cast: cloud, mac, boss, cron-runner, octo, guest-ghost.
export const ROLE_TO_CHAR: Record<string, string> = {
  'boss':          bossSprite,
  'cloud':         'Claude-1',
  'mac':           'employee-1',
  'cron-runner':   'dev-1',
  'github':        'employee-3',
  'octo':          'employee-3',
  'guest-ghost':   'employee-2',
  'assistant':     'Claude-1',
  'debugger':      'dev-1',
  'code-reviewer': 'employee-1',
  'frontend-developer': 'Frontend-dev-1',
  'fullstack-developer': 'dev-2',
  'test-engineer': 'employee-2',
  'security-auditor': 'security-audit-1',
  'devops-engineer': 'employee-3',
  'architect-reviewer': 'employee-1',
  'performance-engineer': 'employee-2',
  'database-architect': 'employee-3',
  'typescript-pro': 'employee-1',
  'ai-engineer': 'dev-2',
  'prompt-engineer': 'dev-2',
  'general-purpose': 'employee-3',
  'researcher': 'explore-1',
  'coder': 'dev-1',
  'reviewer': 'employee-1',
  'generalist': 'employee-3',
  'Explore': 'explore-1',
  // MCPs
  'supabase': 'Frontend-dev-1',
  'playwright': 'employee-2',
  'chrome': 'employee-1',
  'memory': 'dev-2',
  'seo': 'Frontend-dev-1',
  'gmail': 'dev-1',
  'ios-simulator': 'security-audit-1',
}

// ---------------------------------------------------------------------------
// Donghua cast
// ---------------------------------------------------------------------------
// The sprites above are the upstream Claude-Office cast, and 108 of them are
// recognisable likenesses from a television series — a liability in a product
// sold at this price, quite apart from the look. They are replaced by eight
// original donghua archetypes, each standing in for a job rather than a
// person, so a fleet of forty agents still reads as eight legible silhouettes
// at 96 px instead of forty indistinguishable ones.
export const DONGHUA_ARCHETYPES = [
  'cultivator',   // fullstack / default
  'weaver',       // frontend
  'forge',        // devops
  'guardian',     // security
  'scholar',      // reviewer
  'alchemist',    // tester
  'physician',    // debugger
  'elder',        // manager / boss
] as const

// Only these have all four facings built. Anything mapped to an archetype that
// is not here falls back, rather than requesting a sprite that 404s and
// renders as a broken image with no signal — the exact failure the static
// 404 test was written to catch.
export const DONGHUA_BUILT = new Set([
  'alchemist', 'cultivator', 'elder', 'forge',
  'guardian', 'physician', 'scholar', 'weaver',
])
export const DONGHUA_FALLBACK = 'cultivator'

export const ROLE_TO_ARCHETYPE: Record<string, string> = {
  'boss':          'elder',
  'manager':       'elder',
  'cloud':         'cultivator',
  'mac':           'cultivator',
  'cron-runner':   'forge',
  'github':        'forge',
  'octo':          'forge',
  'guest-ghost':   'cultivator',
  'assistant':     'cultivator',
  'debugger':      'physician',
  'code-reviewer': 'scholar',
  'reviewer':      'scholar',
  'architect-reviewer': 'scholar',
  'frontend-developer': 'weaver',
  'fullstack-developer': 'cultivator',
  'test-engineer': 'alchemist',
  'tester':        'alchemist',
  'security-auditor': 'guardian',
  'devops-engineer': 'forge',
  'performance-engineer': 'alchemist',
  'database-architect': 'forge',
  'typescript-pro': 'cultivator',
  'ai-engineer':   'cultivator',
  'prompt-engineer': 'scholar',
  'general-purpose': 'cultivator',
  'generalist':    'cultivator',
  'researcher':    'scholar',
  'Explore':       'scholar',
  'coder':         'cultivator',
  // MCPs
  'supabase':      'forge',
  'playwright':    'alchemist',
  'chrome':        'weaver',
  'memory':        'scholar',
  'seo':           'weaver',
  'gmail':         'weaver',
  'ios-simulator': 'guardian',
}

/** Archetype for a role, guaranteed to be one that actually has sprites. */
export function archetypeFor(role: string): string {
  const want = ROLE_TO_ARCHETYPE[role] ?? DONGHUA_FALLBACK
  return DONGHUA_BUILT.has(want) ? want : DONGHUA_FALLBACK
}
