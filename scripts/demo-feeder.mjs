/**
 * demo-feeder — a living office for a preview, built only from real events.
 *
 * This posts to the same public POST /event the cloud and mac bridges use,
 * with the same bridge tokens and the same validation. Nothing here reaches
 * into the UI or fakes a socket frame: if an event shows up on screen it went
 * through the bus, the policy and the ledger exactly like production traffic.
 *
 * Run:  node scripts/demo-feeder.mjs
 * Stop: Ctrl-C. It writes no files and keeps no state.
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.office', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const API = process.env.OFFICE_API || 'http://localhost:7333'
const CLOUD = env.OFFICE_CLOUD_TOKEN
const MAC = env.OFFICE_MAC_TOKEN
if (!CLOUD || !MAC) {
  console.error('demo-feeder: bridge tokens missing from .env.office')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = (ms) => ms * (0.6 + Math.random() * 0.8)

async function post(token, body) {
  try {
    const r = await fetch(`${API}/event`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) console.error('  ×', r.status, body.type)
  } catch (e) {
    console.error('  ×', e.message)
  }
}

// Costs are small and plausible. The ledger is real, so these do accumulate.
const WORK = [
  [CLOUD, 'cloud', 'ledger.verify', 'memeriksa rantai 2.400 catatan', 0.04],
  [CLOUD, 'cloud', 'policy.check', 'izin masuk Bilik Rajah', 0.01],
  [MAC, 'mac', 'vite.build', 'membangun bundel frontend', 0.09],
  [MAC, 'mac', 'vitest.run', '179 tes frontend', 0.06],
  [CLOUD, 'octo', 'github.poll', 'menarik commit baru', 0.02],
  [MAC, 'mac', 'sbom.generate', '289 komponen', 0.05],
  [CLOUD, 'cloud', 'apca.check', '29 pasangan token', 0.01],
]

async function main() {
  console.log('demo-feeder → ' + API)

  for (const [tok, name, role, task] of [
    [CLOUD, 'cloud', 'relay', 'menjaga rantai ledger'],
    [MAC, 'mac', 'smith', 'menempa bundel rilis'],
    [CLOUD, 'octo', 'scribe', 'mencatat commit masuk'],
  ]) {
    await post(tok, { type: 'agent_spawned', agent: { name, role, task } })
    await sleep(500)
  }

  let n = 0
  for (;;) {
    const [tok, agentId, tool, detail, costUsd] = WORK[n % WORK.length]
    await post(tok, { type: 'tool_call', agentId, tool, detail })
    await sleep(jitter(2200))
    await post(tok, { type: 'tool_done', agentId, tool, costUsd })

    if (n % 5 === 4) {
      await post(CLOUD, {
        type: 'git_push',
        repo: 'hermes-office',
        author: 'niu',
        commits: 1 + (n % 3),
        message: 'rombak frontend Perguruan',
      })
    }
    if (n % 7 === 6) {
      await post(CLOUD, { type: 'cron_fired', job: 'sbom.nightly', ok: true })
    }
    n += 1
    await sleep(jitter(3200))
  }
}

main()
