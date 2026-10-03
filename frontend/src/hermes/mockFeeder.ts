/**
 * Mock event feeder — drives the office with realistic Hermes events so the
 * frontend animates without the office-server running. Enabled with ?mock=1
 * (or ?mock). Also usable standalone: `node scripts/mock-feed.mjs --ws <url>`
 * to broadcast frames to a real office-server WS.
 *
 * In-app mode: events are fed directly through the same handleEvent pipeline
 * the WS client uses (see useOfficeSocket.inject).
 */
import type { HermesEnvelope } from './types'

const TASKS = [
  'audit repo asn-admin', 'generate laporan mingguan', 'refactor eventbus',
  'deploy bot telegram', 'research competitor pricing', 'tulis skrip migrasi db',
  'review PR #42', 'update dokumentasi API',
]

const TOOLS = ['web_search', 'read_file', 'terminal', 'write_file', 'browser']

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Build one random Hermes event. */
export function makeMockEvent(seq: number): HermesEnvelope {
  const roll = seq % 10

  if (roll === 0 || roll === 1) {
    const name = rand(['cloud', 'mac', 'sub:researcher', 'cron:price-monitor'])
    return {
      type: 'agent_spawned',
      source: 'system',
      ts: Date.now(),
      agent: { name, role: rand(['generalist', 'researcher', 'coder', 'reviewer']), task: rand(TASKS), id: `${name}-${seq}` },
    }
  }
  if (roll === 2) {
    return { type: 'tool_call', source: 'cloud', ts: Date.now(), agentId: 'cloud', tool: rand(TOOLS), detail: 'mock detail' }
  }
  if (roll === 3) {
    return { type: 'tool_done', source: 'cloud', ts: Date.now(), agentId: 'cloud', tool: rand(TOOLS) }
  }
  if (roll === 4) {
    return { type: 'mcp_call', source: 'cloud', ts: Date.now(), server: 'github-mcp', tool: 'list_issues', agentId: 'cloud' }
  }
  if (roll === 5) {
    return { type: 'git_push', source: 'github', ts: Date.now(), repo: rand(['brain', 'asn-admin', 'landing-page']), privat: Math.random() < 0.3, author: 'zaryu', commits: 1 + Math.floor(Math.random() * 4), message: rand(['perbarui indeks', 'fix typo', 'tambah fitur', 'refactor modul']) }
  }
  if (roll === 6) {
    return { type: 'cron_fired', source: 'system', ts: Date.now(), job: rand(['price-monitor', 'backup-harian', 'weekly-review']), dest: 'telegram', ok: Math.random() > 0.1 }
  }
  if (roll === 7) {
    return { type: 'a2a_task_in', source: 'mac', ts: Date.now(), dest: 'cloud', peer: 'mac', taskId: `task-${seq}`, summary: rand(['inventory ekosistem', 'cek status bot', 'ringkas repo']) }
  }
  if (roll === 8) {
    return { type: 'agent_status', source: 'system', ts: Date.now(), agent: rand(['cloud', 'mac']), state: rand(['working', 'idle', 'away'] as const), uptimeH: 20 + Math.random() * 10 }
  }
  return { type: 'channel_msg', source: 'system', ts: Date.now(), platform: 'telegram', channelType: 'group', direction: rand(['in', 'out']), agent: 'cloud' }
}

/**
 * Start the in-app mock feeder. Returns a stop function.
 * @param push  callback receiving each generated event
 * @param intervalMs  average interval between events
 */
export function startMockFeeder(
  push: (e: HermesEnvelope) => void,
  intervalMs = 2200,
): () => void {
  let seq = 0
  let stopped = false
  const timers: ReturnType<typeof setTimeout>[] = []

  function scheduleNext() {
    if (stopped) return
    const delay = intervalMs * (0.5 + Math.random())
    timers.push(setTimeout(() => {
      push(makeMockEvent(seq++))
      scheduleNext()
    }, delay))
  }

  scheduleNext()
  return () => { stopped = true; timers.forEach(clearTimeout) }
}
