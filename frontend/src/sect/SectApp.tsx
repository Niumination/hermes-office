/**
 * Perguruan — the application shell.
 *
 * This replaces HermesOfficeApp, which imported five stylesheets and wrapped a
 * 22 kB isometric stage. The grid here is three columns and one bar; every
 * region owns exactly one idea:
 *
 *   Tataran rail    — permission, as altitude
 *   the hall     — presence, as a place
 *   Babad chronicle — history, as a record
 *
 * The data layer underneath is untouched: useOfficeSocket, eventMap,
 * useBurnState and policyClient are the same modules the old UI used, because
 * none of them were the problem.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/sect.css'

import { useOfficeSocket } from '../hermes/useOfficeSocket'
import { usePresence } from '../hermes/usePresence'
import { formatLastSeen } from '../hermes/wib'
import { useBurnState } from '../hermes/useBurnState'
import { targetRoomFor, agentForEnvelope } from '../hermes/eventMap'
import type { HermesEnvelope } from '../hermes/types'
import { fetchLadder, type PolicySnapshot } from '../theme/policyClient'
import { SECT_HALLS } from '../theme/sect'
import { platePath } from '../theme/plates'
import { ROOMS, type RoomId } from '../rooms'
import { useNiuMode, toggleNiuMode, useLang, toggleLang, getStrings } from '../hermes/niu'
import RealmRail from './RealmRail'
import Hall, { type Cultivator } from './Hall'
import Chronicle from './Chronicle'
import Sabda from './Sabda'
import Outposts from './Outposts'
import { useOutposts } from './useOutposts'
import { useSabda } from './useSabda'
import QiRing from './QiRing'
import Seal from './Seal'
import Writ from './Writ'

/**
 * A disciple's mark — the two letters inside the qi aura.
 *
 * These used to be single Han glyphs — one for the boss, one for the test
 * engineer, which is a thing Chinese can do and Latin script cannot: one
 * character carrying a whole word. The honest Latin equivalent is an
 * initialism, not a single letter, because one letter collides immediately
 * (Telaah / Tolak / Tenaga all start with T).
 *
 * Two letters, drawn from the Indonesian role name, so the mark still means
 * something to a reader rather than being a hash of the agent id.
 */
const MARK: Record<string, string> = {
  boss: 'KT',                  // Ketua
  cloud: 'AW',                 // Awan
  mac: 'AL',                   // Alat
  octo: 'GD',                  // Gudang
  github: 'GD',                // Gudang
  'cron-runner': 'WK',         // Waktu
  debugger: 'PR',              // Periksa
  'code-reviewer': 'TL',       // Telaah
  'frontend-developer': 'RP',  // Rupa
  'test-engineer': 'UJ',       // Uji
  'security-auditor': 'JG',    // Jaga
}

/** Fallback when an agent id is not in the table: its own first two letters. */
const markFor = (id: string): string =>
  MARK[id] ?? (id.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'MR')

const PRESENT_MS = 10 * 60 * 1000

interface RosterRow {
  id: string
  room?: RoomId
  task?: string
  seen: number
  online: boolean
  lastSeenTs?: number
}

interface Tracked {
  id: string
  room: RoomId
  task?: string
  seen: number
  working: boolean
}

export const SectApp: React.FC = () => {
  const niu = useNiuMode()
  const lang = useLang()
  const strings = getStrings()

  const [ladder, setLadder] = useState<PolicySnapshot | null>(null)
  const [room, setRoom] = useState<RoomId>('lobby')
  // Follow the activity until the operator picks a hall themselves. Opening on
  // an empty Gerbang Gunung while three disciples work two halls up makes the product
  // look asleep; yanking the view around after someone has deliberately
  // navigated is worse. So: follow by default, stop following on first click.
  const followRef = useRef(true)
  const [tab, setTab] = useState<'chronicle' | 'roster' | 'sabda' | 'posts'>('chronicle')
  const [, tick] = useState(0)
  const agentsRef = useRef<Map<string, Tracked>>(new Map())

  const onEvent = useCallback((e: HermesEnvelope) => {
    const who = agentForEnvelope(e)
    if (!who) return
    const prev = agentsRef.current.get(who)
    const task =
      typeof (e.agent as { task?: string } | undefined)?.task === 'string'
        ? (e.agent as { task?: string }).task
        : typeof e.tool === 'string' ? e.tool
        : typeof e.summary === 'string' ? e.summary
        : prev?.task
    const where = targetRoomFor(e)
    agentsRef.current.set(who, {
      id: who,
      room: where,
      task,
      seen: e.ts ?? Date.now(),
      working: e.type !== 'agent_finished' && e.type !== 'tool_done',
    })
    if (followRef.current) setRoom(where)
    tick((n) => n + 1)
  }, [])

  // Sabda owns the chat transcript; its frame handlers go straight into the
  // socket so there is one connection, not a second one for chat.
  const sabda = useSabda()
  const posts = useOutposts()
  const { connected, offline, events, serverVersion, rttMs } = useOfficeSocket({
    onEvent,
    onChatDelta: sabda.onChatDelta,
    onChatDone: sabda.onChatDone,
    onTyping: sabda.onTyping,
    onReaction: sabda.onReaction,
  })
  const { state: burn, snapshot } = useBurnState(events)

  useEffect(() => {
    let alive = true
    void (async () => {
      let l = await fetchLadder()
      if (!l) {
        // No session yet. `GET /kiosk` is one of exactly two routes that mint
        // an auto-guest session (the other is `GET /`, which Vite owns in dev,
        // so it never reaches the server). Touching it once turns an anonymous
        // visitor into a guest who may see the mountain with its budgets
        // redacted — which is the designed guest experience, not a fallback.
        try { await fetch('/kiosk', { credentials: 'include' }) } catch { /* offline */ }
        l = await fetchLadder()
      }
      if (!alive || !l) { if (alive) setLadder(l); return }

      // Seed the halls from the server's floor plan before trusting the
      // socket. Without this the mountain is deserted on every page load and
      // only fills as events happen to arrive, so a fleet that is working but
      // quiet looks like a fleet that is dead. The placement is the server's,
      // not a guess from event shapes.
      //
      // Anyone the socket has ALREADY told us about is left alone: a live
      // event is fresher than a snapshot taken during the fetch, and
      // overwriting it would make an agent jump back to where it was.
      let seeded = false
      for (const [id, room] of Object.entries(l.placements)) {
        if (agentsRef.current.has(id)) continue
        agentsRef.current.set(id, {
          id,
          room,
          task: undefined,
          // Not a sighting. `seen: 0` keeps the agent out of the "present"
          // window so it renders as away until something real arrives — the
          // floor plan says where it stands, never that it is awake.
          seen: 0,
          working: false,
        })
        seeded = true
      }
      setLadder(l)
      if (seeded) tick((n) => n + 1)
    })()
    return () => { alive = false }
  }, [])

  // Re-render once a minute so "present" decays without an event arriving.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const tracked = Array.from(agentsRef.current.values())
  const now = Date.now()

  // The socket has no history replay, so a quiet fleet renders an empty
  // mountain and an agent that died an hour ago is indistinguishable from one
  // that never existed. `GET /presence` is the server's answer to both.
  const heartbeats = useMemo(() => {
    const h: Record<string, number> = {}
    for (const t of tracked) h[t.id] = t.seen
    return h
  }, [tracked])
  const presence = usePresence({ heartbeats })

  // Roster = everyone the socket has seen, PLUS everyone the server knows
  // about. Deliberately asymmetric with the hall: presence says who is alive,
  // not where they are, and drawing an agent into a hall on that evidence
  // would be the UI inventing a location. They appear in the roster with
  // their last-seen time until an event places them.
  const roster = useMemo<RosterRow[]>(() => {
    const rows: RosterRow[] = tracked.map((t) => ({
      id: t.id,
      room: t.room as RoomId | undefined,
      task: t.task,
      seen: t.seen,
      online: presence[t.id]?.online ?? now - t.seen <= PRESENT_MS,
      lastSeenTs: presence[t.id]?.lastSeenTs ?? t.seen,
    }))
    const known = new Set(rows.map((r) => r.id))
    for (const [id, row] of Object.entries(presence)) {
      if (known.has(id)) continue
      rows.push({
        id, room: undefined, task: undefined,
        seen: row.lastSeenTs ?? 0,
        online: row.online,
        lastSeenTs: row.lastSeenTs,
      })
    }
    return rows.sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen)
  }, [tracked, presence, now])

  const occupancy = useMemo(() => {
    const o: Record<string, number> = {}
    for (const t of tracked) {
      if (now - t.seen > PRESENT_MS) continue
      o[t.room] = (o[t.room] ?? 0) + 1
    }
    return o
  }, [tracked, now])

  const cultivators: Cultivator[] = tracked
    .filter((t) => t.room === room)
    .sort((a, b) => b.seen - a.seen)
    .map((t) => ({
      id: t.id,
      name: t.id,
      glyph: MARK[t.id] ?? t.id.slice(0, 1).toUpperCase(),
      task: t.task,
      state: now - t.seen > PRESENT_MS ? 'away' : t.working ? 'working' : 'idle',
      qi: burn,
    }))

  const rung = ladder?.rungs.find((r) => r.room === room)
  // A guest sits at viewerTier -1, but the server does NOT 403 a guest asking
  // about a hall — it answers 200 with the budgets redacted. Veiling the whole
  // mountain for guests would be the UI inventing a refusal the server never
  // made, which is the exact dishonesty the veil exists to avoid. So the veil
  // is reserved for a viewer who HAS standing and still lacks enough of it.
  const isGuest = (ladder?.viewerTier ?? -1) < 0
  const locked = Boolean(rung && ladder && !isGuest && rung.tier > ladder.viewerTier)
  const hall = SECT_HALLS[room]
  const plate = platePath(room, 'sect', ROOMS[room]?.background?.day ?? '')

  return (
    <div className="sect-app">
      <header className="sect-bar">
        <div className="sect-seal">
          <div className="sect-seal__mark sect-script" aria-hidden="true">PG</div>
          <div>
            <div className="sect-seal__name">
              {(lang === 'id' ? strings.officeTitle : 'Hermes Office').replace(/[^\p{L}\p{N}\s·—-]/gu, '').trim()}
            </div>
            <div className="sect-seal__sub">
              {connected ? `terhubung${serverVersion ? ` · v${serverVersion}` : ''}`
                : offline ? 'luring' : 'menyambung…'}
              {connected && rttMs != null && ` · ${rttMs} ms`}
            </div>
          </div>
        </div>

        <span className={`sect-dot ${connected ? 'sect-dot--live' : 'sect-dot--dead'}`} />

        <div className="sect-bar__spacer" />

        <QiRing state={burn} snapshot={snapshot} />

        <div className="sect-stat">
          <span className="caps">Murid</span>
          <span className="sect-stat__v">{Object.values(occupancy).reduce((a, b) => a + b, 0)}</span>
        </div>

        <Seal />

        <button
          type="button"
          className="sect-pill"
          aria-pressed={niu}
          onClick={toggleNiuMode}
          title="Palet chrome LightVela"
        >
          niu
        </button>
        <button type="button" className="sect-pill" onClick={toggleLang}>
          {lang === 'id' ? 'ID' : 'EN'}
        </button>
      </header>

      <RealmRail
        ladder={ladder}
        current={room}
        occupancy={occupancy}
        onEnter={(r) => { followRef.current = false; setRoom(r) }}
      />

      <Hall
        room={room}
        hall={hall}
        plate={plate}
        locked={locked}
        guest={isGuest}
        cultivators={cultivators}
      />

      <aside className="sect-scroll">
        <Writ />

        <div className="sect-tabs" role="tablist">
          <button
            type="button" role="tab" className="sect-tab"
            aria-selected={tab === 'chronicle'}
            onClick={() => setTab('chronicle')}
          >Babad</button>
          <button
            type="button" role="tab" className="sect-tab"
            aria-selected={tab === 'roster'}
            onClick={() => setTab('roster')}
          >Murid</button>
          <button
            type="button" role="tab" className="sect-tab"
            aria-selected={tab === 'sabda'}
            onClick={() => setTab('sabda')}
          >Sabda</button>
          <button
            type="button" role="tab" className="sect-tab"
            aria-selected={tab === 'posts'}
            onClick={() => setTab('posts')}
          >Pos Jaga</button>
        </div>

        {tab === 'posts' ? (
          <Outposts
            outposts={posts.outposts}
            problems={posts.problems}
            loaded={posts.loaded}
            stale={posts.stale}
            lastOkTs={posts.lastOkTs}
            isOwner={!isGuest}
          />
        ) : tab === 'sabda' ? (
          <Sabda
            messages={sabda.messages}
            typing={sabda.typing}
            refusal={sabda.refusal}
            loaded={sabda.loaded}
            guest={isGuest}
            onSend={(t) => { void sabda.send(t) }}
            onReact={(id, emoji) => { void sabda.react(id, emoji) }}
          />
        ) : tab === 'chronicle' ? (
          <Chronicle events={events} />
        ) : (
          <div className="sect-log">
            {roster.length === 0 && <p className="sect-log__empty">Belum ada murid.</p>}
            {roster.map((r) => {
              const h = r.room ? SECT_HALLS[r.room] : undefined
              return (
                <article
                  key={r.id}
                  className={`sect-entry${r.online ? '' : ' sect-entry--offline'}`}
                >
                  <span className="sect-entry__t">{markFor(r.id)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="sect-entry__who">{r.id}</div>
                    <div className="sect-entry__what">
                      {r.online
                        ? (h ? `${h.nameId} · ${h.nameEn}` : 'belum menampakkan diri')
                        : `sunyi · terakhir aktif ${formatLastSeen(r.lastSeenTs)}`}
                      {r.online && r.task ? ` — ${r.task}` : ''}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}

export default SectApp
