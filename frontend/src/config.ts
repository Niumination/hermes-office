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

// The role -> sprite map that used to live here was the reader for the old
// top-level sprite set, and it had zero consumers from the Sect migration
// until it was deleted on 2026-10-15. Its replacement is sect/cast.ts, which
// maps agents onto the eight donghua archetypes and is actually rendered.

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
