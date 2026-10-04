/**
 * OfficeStage — the pixel-art office rendering, adapted from Claude-Office
 * App.tsx. Consumes Hermes envelopes (drained from HermesOfficeApp), maps
 * them via eventMap, and drives the same agent animation pipeline.
 *
 * DUAL-SPACE-DESIGN M-A: adds the Server Room ☁️ and Mac Studio 💻 with
 * character room-switching (cloud → server-room, mac → mac-studio), a per-room
 * mini feed, offline presence ("terakhir aktif HH:MM") and a service-status
 * lamp. One canvas; doors switch the active room.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, OfficeEvent } from '../types'
import { AGENT_CONFIGS } from '../types'
import Character from '../components/Character'
import FurnitureRenderer from '../components/FurnitureRenderer'
import { ROOMS, type RoomId } from '../rooms'
import {
  assignSpot, createAgent, stepToward, findWaypointPath, WALK_SPEED,
  workMessage, doneMessage,
} from '../agentManager'
import { BOSS_NAME, BOSS_ROLE } from '../config'
import { mapHermesEvent, targetRoomFor, agentForEnvelope } from '../hermes/eventMap'
import type { HermesEnvelope } from '../hermes/types'
import RoomMiniFeed from '../components/RoomMiniFeed'

const ENTRY = ROOMS['main-office'].entryPoint
const DOOR_TARGET = { x: ENTRY.x, y: ENTRY.y }
const ARRIVAL_THRESHOLD = 0.3
const MAIN_WAYPOINTS = ROOMS['main-office'].waypoints ?? []

// Home room for each cast member (DUAL-SPACE-DESIGN M-A §5.2):
// cloud lives in the Server Room, mac in the Mac Studio, the rest in the office.
const HOME_ROOM: Record<string, RoomId> = {
  cloud: 'server-room',
  mac: 'mac-studio',
  'cron-runner': 'main-office',
  octo: 'main-office',
  boss: 'main-office',
}

const WATCHDOG_MS = 90_000

function computePath(
  room: RoomId,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const waypoints = ROOMS[room].waypoints ?? []
  if (waypoints.length === 0) return []
  return findWaypointPath(from.x, from.y, to.x, to.y, waypoints)
}

// Reduced motion: honour prefers-reduced-motion — agents teleport instead of
// walking (UI-SPEC.md §9).
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface BossCfg { color: string; emoji: string }

const BOSS_CONFIG: BossCfg = {
  color: AGENT_CONFIGS['boss']?.color ?? '#ff4444',
  emoji: AGENT_CONFIGS['boss']?.emoji ?? '👑',
}

function createBoss(): Agent {
  const room = ROOMS['main-office']
  const spot = room.agentSpots.find(s => s.id === 'spot-1')
    ?? room.agentSpots.find(s => s.type === 'desk')!
  const target = { x: spot.x, y: spot.y }
  return {
    id: 'boss',
    name: BOSS_NAME,
    type: 'subagent',
    role: BOSS_ROLE,
    state: 'new-hire',
    position: { x: ENTRY.x, y: ENTRY.y },
    targetPosition: target,
    deskPosition: target,
    room: 'main-office',
    assignedRoom: 'main-office',
    assignedSpotId: spot.id,
    spriteFacing: spot.spriteFacing,
    task: 'Running the show',
    statusText: 'clocked in',
    color: BOSS_CONFIG.color,
    emoji: BOSS_CONFIG.emoji,
    hiredAt: Date.now(),
    pathQueue: computePath('main-office', ENTRY, target),
  }
}

// Permanent cast — always present, each in its home room (UI-SPEC.md §2).
const CAST_IDS = ['cloud', 'mac', 'cron-runner']

function createCastMember(id: string): Agent {
  const home = HOME_ROOM[id] ?? 'main-office'
  const room = ROOMS[home]
  const spot = room.agentSpots.find(s => s.type === 'desk') ?? room.agentSpots[0]
  const target = { x: spot.x, y: spot.y }
  const cfg = AGENT_CONFIGS[id] ?? AGENT_CONFIGS['default']
  const entry = room.entryPoint
  return {
    id,
    name: id,
    type: 'subagent',
    role: id,
    state: 'new-hire',
    position: { x: entry.x, y: entry.y },
    targetPosition: target,
    deskPosition: target,
    room: home,
    assignedRoom: home,
    assignedSpotId: spot.id,
    spriteFacing: spot.spriteFacing,
    task: undefined,
    statusText: 'clocked in',
    color: cfg.color,
    emoji: cfg.emoji,
    hiredAt: Date.now(),
    pathQueue: computePath(home, entry, target),
  }
}

/** Pick a spot for an agent inside a room (desk preferred, else first). */
function spotForRoom(room: RoomId, agentId: string) {
  const r = ROOMS[room]
  if (agentId === 'mac') {
    return r.agentSpots.find(s => s.type === 'desk') ?? r.agentSpots[0]
  }
  return r.agentSpots.find(s => s.id.includes(agentId)) ?? r.agentSpots[0]
}

interface Props {
  phase: 'day' | 'night'
  nightOpacity: number
  /** Drain buffered Hermes envelopes from the parent. */
  drainPending: () => HermesEnvelope[]
  /** Increments whenever new envelopes are buffered. */
  pendingTick: number
  spawnedRef: React.MutableRefObject<Set<string>>
}

const OfficeStage: React.FC<Props> = ({ phase, nightOpacity, drainPending, pendingTick, spawnedRef }) => {
  const [agents, setAgents] = useState<Agent[]>(() => [createBoss(), ...CAST_IDS.map(createCastMember)])
  const agentsRef = useRef<Agent[]>([])
  agentsRef.current = agents
  const occupiedSpotsRef = useRef<Set<string>>(new Set())

  // Active room shown on the single canvas (doors switch it).
  const [activeRoom, setActiveRoom] = useState<RoomId>('main-office')
  // Recent envelopes for the per-room mini feed (kept in state so it re-renders).
  const [recentEnvelopes, setRecentEnvelopes] = useState<HermesEnvelope[]>([])
  // Latest service_status per host → lamp colour in the thematic rooms.
  const [serviceState, setServiceState] = useState<Record<string, 'active' | 'failed' | 'inactive'>>({})

  const reducedMotion = useRef(prefersReducedMotion()).current

  // Handle incoming Hermes envelopes → room switching + office events.
  const envelopesRef = useRef<HermesEnvelope[]>([])
  useEffect(() => {
    envelopesRef.current = drainPending()
    if (envelopesRef.current.length === 0) return

    const buf = envelopesRef.current
    setRecentEnvelopes(prev => [...prev.slice(-29), ...buf])
    // Room routing + presence + service lamps (host-level state).
    setAgents(prev => {
      let next = prev
      for (const env of buf) {
        const room = targetRoomFor(env)
        const who = agentForEnvelope(env)

        if (env.type === 'service_status') {
          const d = env as any
          setServiceState(s => ({ ...s, [d.host]: d.state }))
        }

        // Cast member walks to the room its event came from.
        if (who && HOME_ROOM[who] !== undefined && next.some(a => a.id === who)) {
          next = relocateAgent(next, who, room)
        }

        for (const ev of mapHermesEvent(env)) {
          next = applyOfficeEvent(next, ev, occupiedSpotsRef.current)
        }

        // Presence: heartbeat updates / away timeout carries lastSeenTs.
        if (env.type === 'agent_status') {
          const d = env as any
          const rawAgent = (d.agent as unknown)
          const name = typeof rawAgent === 'string' ? rawAgent : String((rawAgent as { id?: string; name?: string })?.id ?? (rawAgent as { name?: string })?.name ?? '')
          next = next.map(a => {
            if (a.id !== name) return a
            if (d.state === 'away') return { ...a, offline: true, lastSeenTs: d.lastSeenTs ?? a.lastSeenTs }
            return { ...a, offline: false, lastSeenTs: Number(env.ts ?? Date.now()), state: d.state === 'working' ? 'working' : a.state }
          })
        }
      }
      return next
    })
  }, [pendingTick, drainPending])

  // Seed presence from the server snapshot on mount (WS has no history replay):
  // agents already offline show grayscale + "terakhir aktif HH:MM" immediately.
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch('/presence')
        if (!r.ok || stop) return
        const data = await r.json()
        const agentsMap = data?.agents ?? {}
        setAgents(prev => prev.map(a => {
          const p = agentsMap[a.id]
          if (!p) return a
          return { ...a, offline: !p.online, lastSeenTs: p.lastSeenTs ?? a.lastSeenTs }
        }))
      } catch { /* offline server — ignore */ }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  // Client-side presence watchdog: no heartbeat ≥ 90s → offline (mirrors server).
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setAgents(prev => {
        let changed = false
        const next = prev.map(a => {
          if (HOME_ROOM[a.id] === undefined) return a
          const last = a.lastSeenTs ?? a.hiredAt
          const shouldOffline = (a.id === 'cloud' || a.id === 'mac') && now - last > WATCHDOG_MS
          if (shouldOffline && !a.offline) { changed = true; return { ...a, offline: true } }
          return a
        })
        return changed ? next : prev
      })
    }, 15_000)
    return () => clearInterval(id)
  }, [])

  // Animation loop (skipped in reduced-motion mode — agents teleport).
  useEffect(() => {
    if (reducedMotion) return
    let rafId: number
    let lastTime = performance.now()

    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 16.67, 3)
      lastTime = now
      const prev = agentsRef.current
      if (prev.length === 0) { rafId = requestAnimationFrame(tick); return }

      let changed = false
      const next = prev.map(agent => {
        const speed = WALK_SPEED * dt
        const queue = agent.pathQueue ?? []
        const immediateTarget = queue.length > 0 ? queue[0] : agent.targetPosition
        const { position, arrived } = stepToward(agent.position, immediateTarget, speed)
        let updated: Agent = agent

        if (arrived && queue.length > 0) {
          updated = { ...agent, position, pathQueue: queue.slice(1) }
          changed = true
        } else if (arrived) {
          const atDesk = Math.abs(agent.targetPosition.x - agent.deskPosition.x) < ARRIVAL_THRESHOLD
            && Math.abs(agent.targetPosition.y - agent.deskPosition.y) < ARRIVAL_THRESHOLD
          if (agent.state === 'new-hire' || agent.state === 'walking-to-desk') {
            if (atDesk || agent.state === 'new-hire') {
              updated = { ...agent, position, state: 'working', statusText: workMessage() }
              changed = true
            }
          } else if (agent.state === 'completed' || agent.state === 'coffee-break') {
            updated = { ...agent, position }
            changed = true
          }
        } else if (position.x !== agent.position.x || position.y !== agent.position.y) {
          updated = { ...agent, position }
          changed = true
        }
        return updated
      })

      // Prune completed agents at their exit (keep permanent cast + boss).
      const pruned = next.filter(a => {
        if (a.id === 'boss' || CAST_IDS.includes(a.id)) return true
        if (a.state === 'completed') {
          const exit = ROOMS[a.room].entryPoint
          const atDoor = Math.abs(a.position.x - exit.x) < ARRIVAL_THRESHOLD * 2
            && Math.abs(a.position.y - exit.y) < ARRIVAL_THRESHOLD * 2
          if (atDoor) {
            if (a.assignedSpotId) occupiedSpotsRef.current.delete(a.assignedSpotId)
            return false
          }
        }
        return true
      })

      if (changed || pruned.length !== next.length) setAgents(pruned)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [reducedMotion])

  // Reduced-motion: flush agents straight to their targets.
  useEffect(() => {
    if (!reducedMotion) return
    setAgents(prev => prev.map(a => ({
      ...a,
      position: { ...a.targetPosition },
      pathQueue: [],
      state: a.state === 'new-hire' || a.state === 'walking-to-desk' ? 'working' : a.state,
      statusText: a.state === 'new-hire' || a.state === 'walking-to-desk' ? workMessage() : a.statusText,
    })))
  }, [agents, reducedMotion])

  const room = ROOMS[activeRoom]
  const roomImage = phase === 'night' ? room.background.night : room.background.day
  const aspect = room.width / room.height
  const roomAgents = agents.filter(a => a.room === activeRoom)
  const doorCounts = room.connections.map(c => ({
    conn: c,
    count: agents.filter(a => a.room === c.toRoom).length,
  }))

  return (
    <div className="office-view" data-testid="office-stage">
      <div
        className={`room-container${reducedMotion ? ' reduced-motion' : ''}`}
        style={{
          aspectRatio: `${aspect}`,
          width: '100%',
          maxHeight: '100%',
          position: 'relative',
        }}
      >
        <div className="room-background" style={{ backgroundImage: `url(${roomImage})` }} />

        {room.furniture.length > 0 && (
          <FurnitureRenderer items={room.furniture} onItemClick={() => {}} />
        )}

        {roomAgents.map(agent => (
          <Character
            key={agent.id}
            agent={agent}
            zIndex={
              room.agentSpots.find(s => s.id === agent.assignedSpotId)?.zIndex
              ?? Math.round(agent.position.y)
            }
          />
        ))}

        <div className="room-label" data-testid="room-label">{room.name}</div>

        {/* Doors to adjacent rooms — click to switch the viewed room. */}
        {doorCounts.map(({ conn, count }) => (
          <button
            key={conn.toRoom}
            className="room-door-hotspot"
            style={{ left: `${conn.position.x}%`, top: `${conn.position.y}%` }}
            onClick={() => setActiveRoom(conn.toRoom)}
            title={`Buka ${ROOMS[conn.toRoom].name}`}
          >
            <span className="door-arrow">↔</span>
            <span className="door-label">{conn.label ?? ROOMS[conn.toRoom].name}{count > 0 ? ` · ${count}` : ''}</span>
          </button>
        ))}

        {/* Service lamp (server-room/mac-studio) — red on failed units. */}
        {(activeRoom === 'server-room' || activeRoom === 'mac-studio') && (
          <ServiceLamp host={activeRoom === 'server-room' ? 'cloud' : 'mac'} state={serviceState[activeRoom === 'server-room' ? 'cloud' : 'mac']} />
        )}

        <RoomMiniFeed room={activeRoom} events={recentEnvelopes} />
      </div>
    </div>
  )
}

/** Small rack lamp reflecting the latest service_status for a host. */
const ServiceLamp: React.FC<{ host: string; state?: 'active' | 'failed' | 'inactive' }> = ({ host, state }) => {
  if (!state) return null
  return (
    <div className={`service-lamp service-${state}`} data-testid={`service-lamp-${host}`}>
      <span className="service-lamp-dot" />
      <span className="service-lamp-label">{host}: {state}</span>
      {state === 'failed' && <span className="service-smoke">💨</span>}
    </div>
  )
}

/** Move a cast member to `room`, walking from that room's entry point. */
function relocateAgent(prev: Agent[], id: string, room: RoomId): Agent[] {
  return prev.map(a => {
    if (a.id !== id) return a
    if (a.room === room) return a
    const spot = spotForRoom(room, id)
    const entry = ROOMS[room].entryPoint
    const target = { x: spot.x, y: spot.y }
    return {
      ...a,
      room,
      assignedRoom: room,
      assignedSpotId: spot.id,
      spriteFacing: spot.spriteFacing,
      position: { x: entry.x, y: entry.y },
      targetPosition: target,
      deskPosition: target,
      pathQueue: computePath(room, entry, target),
      state: 'walking-to-desk',
    }
  })
}

/** Apply one internal office event to the agent list. */
function applyOfficeEvent(
  prev: Agent[],
  ev: OfficeEvent,
  occupied: Set<string>,
): Agent[] {
  switch (ev.type) {
    case 'agent_spawned': {
      const raw = ev.agent ?? {}
      const id = String(raw.id ?? `agent-${Date.now()}`)
      const name = String(raw.name ?? 'Agent')
      const role = String(raw.role ?? 'general-purpose')
      const task = raw.task ? String(raw.task) : undefined
      if (prev.some(a => a.id === id)) return prev

      const room: RoomId = 'main-office'
      const spot = assignSpot(prev.filter(a => a.room === room), ROOMS[room].agentSpots)
      if (!spot) return prev
      occupied.add(spot.id)

      const agent = createAgent({ id, name, role, task, spot })
      return [...prev, {
        ...agent,
        room,
        assignedRoom: room,
        pathQueue: computePath(room, agent.position, agent.targetPosition),
      }]
    }

    case 'agent_working': {
      const id = ev.agentId
      const status = ev.status ?? workMessage()
      if (!id) return prev
      return prev.map(a => a.id === id
        ? { ...a, state: 'working' as const, statusText: status }
        : a)
    }

    case 'agent_completed': {
      const id = ev.agentId
      if (!id) return prev
      const status = ev.result ?? doneMessage()
      return prev.map(a => {
        if (a.id !== id) return a
        occupied.delete(a.assignedSpotId ?? '')
        const exit = ROOMS[a.room].entryPoint
        return {
          ...a,
          state: 'completed' as const,
          statusText: status,
          targetPosition: { ...exit },
          pathQueue: computePath(a.room, a.position, exit),
        }
      })
    }

    case 'mcp_call': {
      const id = ev.agentId
      if (!id) return prev
      // Octo appears in the Mac Studio on git_push (mapped to mcp_call).
      const known = ['octo', 'cron-runner']
      if (known.includes(id) && !prev.some(a => a.id === id)) {
        const room: RoomId = id === 'octo' ? 'mac-studio' : 'server-room'
        const spot = assignSpot(prev.filter(a => a.room === room), ROOMS[room].agentSpots)
          ?? ROOMS[room].agentSpots[0]
        if (!spot) return prev
        occupied.add(spot.id)
        const agent = createAgent({ id, name: id, role: id, task: ev.status, spot })
        return [...prev, {
          ...agent,
          room,
          assignedRoom: room,
          position: { ...ROOMS[room].entryPoint },
          targetPosition: { x: spot.x, y: spot.y },
          deskPosition: { x: spot.x, y: spot.y },
          pathQueue: computePath(room, ROOMS[room].entryPoint, { x: spot.x, y: spot.y }),
        }]
      }
      return prev.map(a => a.id === id
        ? { ...a, statusText: ev.status ?? 'mcp' }
        : a)
    }

    default:
      return prev
  }
}

export default OfficeStage
