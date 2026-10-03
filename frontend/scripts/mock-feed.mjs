#!/usr/bin/env node
/**
 * Mock event feeder for Hermes Office — broadcasts realistic Hermes events to
 * a running office-server WS so the office animates without real agents.
 *
 * Usage:
 *   node scripts/mock-feed.mjs                          # ws://localhost:3334/ws
 *   node scripts/mock-feed.mjs --ws ws://host/ws        # custom WS
 *   node scripts/mock-feed.mjs --interval 1000          # faster feed
 *
 * Protocol: each frame is JSON `{"channel":"event","data":{...envelope}}`
 * (see docs/EVENTS.md §4).
 */

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const WS_URL = arg('ws', process.env.HERMES_OFFICE_WS ?? 'ws://localhost:3334/ws')
const INTERVAL = Number(arg('interval', process.env.HERMES_OFFICE_INTERVAL ?? 2200))

const TASKS = [
  'audit repo asn-admin', 'generate laporan mingguan', 'refactor eventbus',
  'deploy bot telegram', 'research competitor pricing', 'tulis skrip migrasi db',
  'review PR #42', 'update dokumentasi API',
]
const TOOLS = ['web_search', 'read_file', 'terminal', 'write_file', 'browser']
const REPOS = ['brain', 'asn-admin', 'landing-page']
const JOBS = ['price-monitor', 'backup-harian', 'weekly-review']
const MESSAGES = ['perbarui indeks', 'fix typo', 'tambah fitur', 'refactor modul']

const rand = arr => arr[Math.floor(Math.random() * arr.length)]

let seq = 0
function makeEvent() {
  const roll = seq % 10
  const ts = Date.now()
  seq += 1
  switch (roll) {
    case 0: case 1:
      return {
        type: 'agent_spawned', source: 'system', ts,
        agent: {
          name: rand(['cloud', 'mac', 'sub:researcher', 'cron:price-monitor']),
          role: rand(['generalist', 'researcher', 'coder', 'reviewer']),
          task: rand(TASKS),
          id: `mock-${seq}`,
        },
      }
    case 2: return { type: 'tool_call', source: 'cloud', ts, agentId: 'cloud', tool: rand(TOOLS), detail: 'mock detail' }
    case 3: return { type: 'tool_done', source: 'cloud', ts, agentId: 'cloud', tool: rand(TOOLS) }
    case 4: return { type: 'mcp_call', source: 'cloud', ts, server: 'github-mcp', tool: 'list_issues', agentId: 'cloud' }
    case 5:
      return {
        type: 'git_push', source: 'github', ts,
        repo: rand(REPOS), privat: Math.random() < 0.3, author: 'zaryu',
        commits: 1 + Math.floor(Math.random() * 4), message: rand(MESSAGES),
      }
    case 6:
      return { type: 'cron_fired', source: 'system', ts, job: rand(JOBS), dest: 'telegram', ok: Math.random() > 0.1 }
    case 7:
      return { type: 'a2a_task_in', source: 'mac', ts, dest: 'cloud', peer: 'mac', taskId: `task-${seq}`, summary: rand(['inventory ekosistem', 'cek status bot', 'ringkas repo']) }
    case 8:
      return { type: 'agent_status', source: 'system', ts, agent: rand(['cloud', 'mac']), state: rand(['working', 'idle', 'away']), uptimeH: 20 + Math.random() * 10 }
    default:
      return { type: 'channel_msg', source: 'system', ts, platform: 'telegram', channelType: 'group', direction: rand(['in', 'out']), agent: 'cloud' }
  }
}

let ws
let retryTimer

function connect() {
  ws = new WebSocket(WS_URL)
  ws.onopen = () => {
    console.log(`[mock-feed] connected → ${WS_URL}`)
    schedule()
  }
  ws.onclose = () => {
    console.log('[mock-feed] disconnected — retrying in 3s')
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, 3000)
  }
  ws.onerror = () => { /* onclose follows */ }
}

function schedule() {
  setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) return
    const ev = makeEvent()
    ws.send(JSON.stringify({ channel: 'event', data: ev }))
    console.log(`[mock-feed] → ${ev.type}`)
    schedule()
  }, INTERVAL * (0.5 + Math.random()))
}

console.log(`[mock-feed] starting — target ${WS_URL}, interval ~${INTERVAL}ms`)
connect()

process.on('SIGINT', () => { try { ws.close() } catch {} process.exit(0) })
