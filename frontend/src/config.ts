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

// Map agent roles → character sprite base names (in /sprites/characters/).
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
