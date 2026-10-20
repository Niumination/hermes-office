/**
 * Perguruan — the application shell.
 *
 * This replaces HermesOfficeApp, which imported five stylesheets and wrapped a
 * 22 kB isometric stage. The grid here is three columns and one bar; every
 * region owns exactly one idea:
 *
 *   Ecosystem rail  — office, then room; not a ladder. The label read
 *                     'Tataran' until 2026-10-17, three commits after the
 *                     tiers it named were retracted: the button still
 *                     promised a rank the office no longer has.
 *   the hall     — presence, as a place
 *   Babad chronicle — history, as a record
 *
 * The data layer underneath is untouched: useOfficeSocket, eventMap,
 * policyClient is the same module the old UI used, because
 * none of them were the problem.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/sect.css'

import { useOfficeSocket } from '../hermes/useOfficeSocket'
import { usePresence } from '../hermes/usePresence'
import { formatLastSeen } from '../hermes/wib'
import { targetRoomFor, agentForEnvelope } from '../hermes/eventMap'
import type { HermesEnvelope } from '../hermes/types'
import { fetchLadder, type PolicySnapshot } from '../theme/policyClient'
import { platePath } from '../theme/plates'
import { ROOMS, type RoomId } from '../rooms'
import { useNiuMode, toggleNiuMode, useLang, toggleLang, getStrings } from '../hermes/niu'
import { fetchRoster, type RosterAgent } from './rosterClient'
import { spriteFor, archetypeFor } from './cast'
import EcoRail from './EcoRail'
import {
  OFFICES, roomsOf, roomAt, desksOf, type OfficeId,
  roomRef,
  roomByRef,
} from '../eco/ecosystem'
import Hall, { type Cultivator } from './Hall'
import Chronicle from './Chronicle'
import Sabda from './Sabda'
import Outposts from './Outposts'
import { useOutposts } from './useOutposts'
import AmanatBoard from './AmanatBoard'
import { useAmanat } from './useAmanat'
import { useSabda } from './useSabda'
import Seal from './Seal'
import Warrant from './Warrant'
import Writ from './Writ'

/**
 * A disciple's mark — the two letters inside the badge.
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
  /**
   * An ecosystem reference — `office/room`, e.g. `mac/root` — not a bare id
   * and not a fork RoomId. This field used to be typed `RoomId` and filled
   * through an `as` cast, which is precisely what let two lookups below go on
   * resolving it with the wrong function without tsc ever objecting.
   */
  room?: string
  task?: string
  seen: number
  online: boolean
  lastSeenTs?: number
}

interface Tracked {
  id: string
  /**
   * Whatever the server called the room. A plain string on purpose: the
   * server still speaks the fork's vocabulary here while the screens speak
   * the ecosystem's, and narrowing this to either union would throw away the
   * half that does not match instead of showing the mismatch.
   */
  room: string
  task?: string
  seen: number
  working: boolean
}

export const SectApp: React.FC = () => {
  const niu = useNiuMode()
  const lang = useLang()
  const strings = getStrings()

  const [ladder, setLadder] = useState<PolicySnapshot | null>(null)
  // The configured fleet. Separate from `tracked` on purpose: this says who
  // SHOULD be here, which is the only source that knows about an agent that
  // has never emitted an event. See sect/rosterClient.ts.
  const [rosterAgents, setRosterAgents] = useState<RosterAgent[]>([])
  // Which workplace is on screen. LightVela first: this office runs there,
  // so the default view is the machine the viewer is already talking to.
  const [office, setOffice] = useState<OfficeId>('lightvela')
  // A room id from the ecosystem model, never a fork RoomId. 'root' exists
  // in both offices, which is why switching office cannot land nowhere.
  const [room, setRoom] = useState<string>('root')
  // Follow the activity until the operator picks a room themselves. Opening on
  // an empty landing room while three disciples work elsewhere makes the
  // product look asleep; yanking the view around after someone has
  // deliberately navigated is worse. So: follow by default, stop following on
  // first click.
  const followRef = useRef(true)
  // The socket callback is created once with no deps, so reading `office`
  // from it would read the value at mount forever. Same reason followRef
  // exists. Kept in sync below.
  const officeRef = useRef<OfficeId>('lightvela')
  const [tab, setTab] = useState<'chronicle' | 'roster' | 'sabda' | 'posts'>('chronicle')
  officeRef.current = office
  const [, tick] = useState(0)
  const agentsRef = useRef<Map<string, Tracked>>(new Map())

  /**
   * Counter the Amanat board watches. Bumped when a task-bearing event lands
   * so the board refetches immediately instead of waiting out its 15s poll.
   *
   * A counter rather than the parsed task: the server owns the lifecycle fold
   * (server/tasks.js), and re-deriving lanes here would be a second
   * implementation of the same rules, free to disagree with the chain.
   */
  const [taskNudge, setTaskNudge] = useState(0)

  /**
   * Panel visibility, following The-Office's shell: the office is the page,
   * and the side panels are furniture you can move out of the way. Both rails
   * used to be permanent, which left the hall — the only part that shows the
   * ecosystem actually working — squeezed into the middle third of a 1440px
   * screen.
   */
  const [railOpen, setRailOpen] = useState(true)
  const [scrollOpen, setScrollOpen] = useState(true)

  /**
   * Amanat opens as a floating overlay rather than a tab. A board wants
   * horizontal lanes and the right rail is ~330px; as a modal it gets the
   * full width and the lanes can finally sit side by side.
   */
  const [boardOpen, setBoardOpen] = useState(false)

  const onEvent = useCallback((e: HermesEnvelope) => {
    // Task-bearing events move the Amanat board. Checked before the agent
    // lookup below, because `task_update` need not name an agent and would
    // otherwise be dropped by the early return.
    if (e.type === 'task_update' || e.type === 'a2a_task_in' || e.type === 'a2a_task_out') {
      setTaskNudge((n) => n + 1)
    }

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
    // Follow the action only when the server's room name resolves to a room
    // that exists in the office on screen. The server still speaks the fork's
    // vocabulary (`lobby`, `server-room`), which names nothing in the owner's
    // ecosystem; jumping the camera to it would move the viewer somewhere that
    // does not exist. Staying put is the honest failure — and the mismatch is
    // a real open seam, not a bug in this guard.
    // Follow within the office on screen only. The two offices are two
    // machines and the viewer switches between them deliberately; yanking
    // the screen to the other machine because something happened there would
    // be the camera making that decision for them.
    const target = where ? roomByRef(where) : undefined
    if (followRef.current && target && target.office === officeRef.current) {
      setRoom(target.id)
    }
    tick((n) => n + 1)
  }, [])

  // Sabda owns the chat transcript; its frame handlers go straight into the
  // socket so there is one connection, not a second one for chat.
  const sabda = useSabda()
  const posts = useOutposts()
  const amanat = useAmanat({ nudge: taskNudge })
  const { connected, offline, events, serverVersion, rttMs } = useOfficeSocket({
    onEvent,
    onChatDelta: sabda.onChatDelta,
    onChatDone: sabda.onChatDone,
    onTyping: sabda.onTyping,
    onReaction: sabda.onReaction,
  })

  useEffect(() => {
    let alive = true
    void (async () => {
      // No session, no data. This used to touch `GET /kiosk` to mint an
      // auto-guest session so an anonymous visitor saw a redacted mountain.
      // That route is gone: the office has one occupant, and the way in is
      // the owner token through Warrant. A null ladder is not a failure
      // state here — it is the locked door, and the shell renders it.
      const l = await fetchLadder()
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

  // The configured fleet, fetched once. Deliberately a separate effect from
  // the ladder: the roster is an enrichment, and a server that answers
  // /policy but not /roster must still draw the halls it can.
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await fetchRoster()
      if (alive) setRosterAgents(r)
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
      room: t.room,
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

  const roleOf = useMemo(() => {
    const m: Record<string, string | undefined> = {}
    for (const a of rosterAgents) m[a.id] = a.role
    return m
  }, [rosterAgents])

  // `office/room`, because that is how the governance layer names a room and
  // `root` exists in both offices. Comparing bare ids used to show a Mac agent
  // standing in LightVela's root, and the other way round.
  const here = roomRef(office, room)
  const cultivators: Cultivator[] = tracked
    .filter((t) => t.room === here)
    .sort((a, b) => b.seen - a.seen)
    .map((t) => {
      const state: Cultivator['state'] =
        now - t.seen > PRESENT_MS ? 'away' : t.working ? 'working' : 'idle'
      return {
        id: t.id,
        name: t.id,
        glyph: MARK[t.id] ?? t.id.slice(0, 1).toUpperCase(),
        task: t.task,
        state,
        sprite: spriteFor(t.id, state, roleOf[t.id]),
        archetype: archetypeFor(t.id, roleOf[t.id]),
      }
    })

  /**
   * Agents the roster lists that the server has never placed in any hall.
   *
   * They are NOT occupants and must never be sorted in among them: the court
   * is the server's floor plan and these agents are absent from it. Showing
   * them at all is still the honest move — "configured but never seen" is a
   * fact about the fleet, and hiding it is what made two thirds of this
   * office invisible. They appear only in the default hall, in their own
   * strip, captioned for exactly what they are.
   */
  const ghosts: Cultivator[] = useMemo(() => {
    // Landing room of the current office, not `ladder.defaultRoom`. The
    // server's default is `belum-dipetakan`, which deliberately names no
    // place and so matches no room on any screen — keying this strip off it
    // would quietly empty it everywhere, the same disappearance the strip
    // exists to stop. It was a fork id ('lobby') until 2026-10-17 and the
    // effect was identical.
    if (room !== 'root') return []
    const placed = new Set(tracked.map((t) => t.id))
    return rosterAgents
      .filter((a) => !placed.has(a.id) && !presence[a.id])
      .map((a) => ({
        id: a.id,
        name: a.id,
        glyph: MARK[a.id] ?? a.id.slice(0, 1).toUpperCase(),
        state: 'ghost' as const,
        sprite: spriteFor(a.id, 'ghost', a.role),
        archetype: archetypeFor(a.id, a.role),
      }))
  }, [rosterAgents, tracked, presence, room, ladder])

  /**
   * Agents the server HAS placed, in a room this office cannot draw.
   *
   * Distinct from ghosts, which are placed nowhere at all. These have a
   * location; it just is not one of ours. While the server still answers in
   * the fork's vocabulary this is where most of the fleet lands, and saying
   * so out loud is the point: the alternative is an empty-looking court with
   * no stated reason, which is the exact failure the floor plan was rebuilt
   * to end.
   */
  const strays = useMemo(
    () => tracked.filter((t) => t.room && roomByRef(t.room)?.office !== office),
    [tracked, office],
  )

  // Signed out means the server answered 401 and there is no ladder at all.
  // There is no second principal: you are the owner or you are outside.
  const signedOut = !ladder
  // The hall's name is now a FACT about the owner's filesystem, not a mood:
  // `nameId` is what they call the folder, `nameEn` is where it lives on disk.
  // An unknown room resolves to undefined and Hall falls back to the raw id —
  // which is the honest outcome, not a fabricated name.
  const ecoRoom = roomAt(office, room)
  const hall = ecoRoom
    ? { nameId: ecoRoom.label, nameEn: ecoRoom.path, band: OFFICES[office].label }
    : undefined
  // Background art only. The eight plates were drawn for the fork's rooms and
  // carry no ecosystem meaning, so they are dealt out by a stable hash of the
  // room id: a room keeps the same backdrop between renders and the backdrop
  // claims nothing. Same rule as the left/right facing in cast.ts — decoration
  // is allowed to be arbitrary, but it must never be mistaken for a fact.
  const PLATES: RoomId[] = ['lobby', 'main-office', 'meeting-room', 'mac-studio', 'server-room', 'ceo-office', 'kitchen', 'nap-room']
  // Hashed over the NAMESPACED reference, not the bare id. `root` exists in
  // both offices, so hashing `room` dealt both of them the same plate and the
  // Mac's ecosystem root and LightVela's were drawn as the same place. The
  // backdrop claims nothing, but it must not claim two places are one.
  let h = 2166136261
  for (let i = 0; i < here.length; i++) { h ^= here.charCodeAt(i); h = Math.imul(h, 16777619) }
  const backdrop = PLATES[Math.abs(h) % PLATES.length]
  const plate = platePath(backdrop, 'sect', ROOMS[backdrop]?.background?.day ?? '')

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


        <div className="sect-stat">
          <span className="caps">Murid</span>
          {/*
            Signed out, every occupancy source answers 401, `occupancy` stays
            `{}`, and this sum used to render a confident `0` — a count the
            office had never been told. An em dash is the honest glyph: the
            question was asked and refused, not asked and answered zero.
          */}
          <span
            className={`sect-stat__v${signedOut ? ' sect-stat__v--unknown' : ''}`}
            title={signedOut
              ? 'Belum masuk — kantor tidak menjawab berapa yang hadir'
              : 'Jumlah yang ditempatkan di seluruh kantor'}
          >
            {signedOut ? '—' : Object.values(occupancy).reduce((a, b) => a + b, 0)}
          </span>
        </div>

        <Seal />

        <Warrant signedOut={signedOut} />

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

      {railOpen && (
        <EcoRail
          office={office}
          room={room}
          occupancy={occupancy}
          onOffice={(o) => {
            followRef.current = false
            setOffice(o)
            // 'root' is the one room id both offices share, so the switch can
            // never strand the viewer in a room that does not exist here.
            setRoom('root')
          }}
          onEnter={(r) => { followRef.current = false; setRoom(r) }}
        />
      )}

      {/* The office is the page. Everything else is furniture around it. */}
      <div className="sect-main">
        <Hall
          room={room}
          hall={hall}
          plate={plate}
          occupancyKnown={!signedOut}
          cultivators={cultivators}
          ghosts={ghosts}
        />

        {/* Floating controls over the hall, as in The-Office's shell. */}
        <div className="sect-float sect-float--left">
          <button
            type="button"
            className="sect-float__btn"
            aria-pressed={railOpen}
            onClick={() => setRailOpen((v) => !v)}
            title={railOpen ? 'Sembunyikan ruang' : 'Tampilkan ruang'}
          >
            {railOpen ? '◀' : '▶'} Ruang
          </button>
        </div>

        <div className="sect-float sect-float--right">
          <button
            type="button"
            className={`sect-float__btn${amanat.blocked > 0 ? ' sect-float__btn--alert' : ''}`}
            onClick={() => setBoardOpen(true)}
            title="Papan Amanat — apa yang sedang dikerjakan"
          >
            Amanat
            <span className="sect-float__count">{signedOut ? '—' : amanat.total}</span>
            {amanat.blocked > 0 && (
              <span className="sect-float__alert">{amanat.blocked} menunggu</span>
            )}
          </button>
          <button
            type="button"
            className="sect-float__btn"
            aria-pressed={scrollOpen}
            onClick={() => setScrollOpen((v) => !v)}
            title={scrollOpen ? 'Sembunyikan panel' : 'Tampilkan panel'}
          >
            {scrollOpen ? '▶' : '◀'} Panel
          </button>
        </div>

        {/* Status strip along the foot of the office. */}
        <footer className="sect-status">
          <span className={`sect-status__dot ${connected ? 'is-live' : 'is-dead'}`} />
          <span className="sect-status__item">
            {connected ? 'terhubung' : offline ? 'luring' : 'menyambung…'}
            {connected && rttMs != null && ` · ${rttMs} ms`}
          </span>
          <span className="sect-status__sep" />
          <span className="sect-status__item">
            {signedOut ? 'penghuni tak diketahui' : `${cultivators.length} di balai ini`}
          </span>
          {ghosts.length > 0 && (
            <span className="sect-status__item sect-status__item--dim">
              {ghosts.length} belum terlihat
            </span>
          )}
          {strays.length > 0 && (
            <span
              className="sect-status__item sect-status__item--dim"
              title={`Ditempatkan server di ruangan yang tidak ada di kantor ini: ${
                [...new Set(strays.map((t) => t.room))].join(', ')
              }`}
            >
              {strays.length} di ruangan tak dikenal
            </span>
          )}
          <span className="sect-status__sep" />
          <span className="sect-status__item">
            {signedOut ? '— amanat' : `${amanat.total} amanat`}
            {amanat.blocked > 0 && (
              <strong className="sect-status__alert"> · {amanat.blocked} menunggu Anda</strong>
            )}
          </span>
          {amanat.stale && (
            <span className="sect-status__item sect-status__item--dim">papan tak tersambung</span>
          )}
        </footer>
      </div>

      {scrollOpen && (
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
            isOwner={!signedOut}
          />
        ) : tab === 'sabda' ? (
          <Sabda
            messages={sabda.messages}
            typing={sabda.typing}
            refusal={sabda.refusal}
            loaded={sabda.loaded}
            signedOut={signedOut}
            onSend={(t) => { void sabda.send(t) }}
            onReact={(id, emoji) => { void sabda.react(id, emoji) }}
          />
        ) : tab === 'chronicle' ? (
          <Chronicle events={events} known={!signedOut} />
        ) : (
          <div className="sect-log">
            {roster.length === 0 && (
              <p className="sect-log__empty">
                {signedOut ? 'Daftar murid tidak terbaca — belum masuk.' : 'Belum ada murid.'}
              </p>
            )}
            {roster.map((r) => {
              // roomByRef, not roomAt: the tracked room is `mac/root`, which
              // never equals a bare room id, so roomAt answered undefined for
              // every agent the office had actually placed and this tab told
              // the owner "belum menampakkan diri" about agents standing in a
              // hall one tab away. It also resolved against the office ON
              // SCREEN, so an agent in the other office would have been
              // labelled with a room it is not in.
              const h = r.room ? roomByRef(r.room) : undefined
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
                        ? (h ? `${h.label} · ${h.path}` : 'belum menampakkan diri')
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
      )}

      {/* Amanat as a floating board — the pattern The-Office uses for its
          Kanban. A modal gets the full width, so the lanes finally sit side
          by side instead of stacking in a 330px rail. */}
      {boardOpen && <AmanatBoard board={amanat} onClose={() => setBoardOpen(false)} />}
      </div>
    )
  }

export default SectApp
