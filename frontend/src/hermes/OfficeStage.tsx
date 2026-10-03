/**
 * OfficeStage — the isometric office rendering, adapted from Claude-Office
 * App.tsx. Consumes Hermes envelopes (drained from HermesOfficeApp), maps
 * them via eventMap, and drives the same agent animation pipeline.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Agent, OfficeEvent } from '../types'
import { AGENT_CONFIGS } from '../types'
import Character from '../components/Character'
import FurnitureRenderer from '../components/FurnitureRenderer'
import { ROOMS } from '../rooms'
import {
  assignSpot, createAgent, stepToward, findWaypointPath, WALK_SPEED,
  workMessage, doneMessage,
} from '../agentManager'
import { BOSS_NAME, BOSS_ROLE } from '../config'
import { mapHermesEvent } from '../hermes/eventMap'
import type { HermesEnvelope } from '../hermes/types'

const MAIN_ROOM = ROOMS['main-office']
const ENTRY = MAIN_ROOM.entryPoint
const DOOR_TARGET = { x: ENTRY.x, y: ENTRY.y }
const ARRIVAL_THRESHOLD = 0.3
const MAIN_WAYPOINTS = MAIN_ROOM.waypoints ?? []

function computePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  if (MAIN_WAYPOINTS.length === 0) return []
  return findWaypointPath(from.x, from.y, to.x, to.y, MAIN_WAYPOINTS)
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
  const spot = MAIN_ROOM.agentSpots.find(s => s.id === 'spot-1')
    ?? MAIN_ROOM.agentSpots.find(s => s.type === 'desk')!
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
    pathQueue: computePath(ENTRY, target),
  }
}

// Permanent cast — always visible in the office (UI-SPEC.md §2).
const CAST_IDS = ['cloud', 'mac', 'cron-runner']

function createCastMember(id: string): Agent {
  const spot = MAIN_ROOM.agentSpots.find(s => s.type === 'desk' && !['spot-1'].includes(s.id))!
  const target = { x: spot.x, y: spot.y }
  const cfg = AGENT_CONFIGS[id] ?? AGENT_CONFIGS['default']
  return {
    id,
    name: id,
    type: 'subagent',
    role: id,
    state: 'new-hire',
    position: { x: ENTRY.x, y: ENTRY.y },
    targetPosition: target,
    deskPosition: target,
    room: 'main-office',
    assignedRoom: 'main-office',
    assignedSpotId: spot.id,
    spriteFacing: spot.spriteFacing,
    task: undefined,
    statusText: 'clocked in',
    color: cfg.color,
    emoji: cfg.emoji,
    hiredAt: Date.now(),
    pathQueue: computePath(ENTRY, target),
  }
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

  const reducedMotion = useRef(prefersReducedMotion()).current

  // Handle incoming Hermes envelopes → office events → state updates.
  const envelopesRef = useRef<HermesEnvelope[]>([])
  useEffect(() => {
    envelopesRef.current = drainPending()
    if (envelopesRef.current.length === 0) return
    setAgents(prev => {
      let next = prev
      for (const env of envelopesRef.current) {
        for (const ev of mapHermesEvent(env)) {
          next = applyOfficeEvent(next, ev, occupiedSpotsRef.current)
        }
      }
      return next
    })
  }, [pendingTick, drainPending])

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
          const atDoor = Math.abs(agent.targetPosition.x - DOOR_TARGET.x) < ARRIVAL_THRESHOLD
            && Math.abs(agent.targetPosition.y - DOOR_TARGET.y) < ARRIVAL_THRESHOLD
          if (agent.state === 'new-hire' || agent.state === 'walking-to-desk') {
            if (atDesk || agent.state === 'new-hire') {
              updated = { ...agent, position, state: 'working', statusText: workMessage() }
              changed = true
            }
          } else if (agent.state === 'completed' && atDoor) {
            updated = { ...agent, position }
            changed = true
          } else if (agent.state === 'coffee-break') {
            updated = { ...agent, position }
            changed = true
          }
        } else if (position.x !== agent.position.x || position.y !== agent.position.y) {
          updated = { ...agent, position }
          changed = true
        }
        return updated
      })

      // Prune completed agents at the door (keep permanent cast + boss).
      const pruned = next.filter(a => {
        if (a.id === 'boss' || CAST_IDS.includes(a.id)) return true
        if (a.state === 'completed') {
          const atDoor = Math.abs(a.position.x - DOOR_TARGET.x) < ARRIVAL_THRESHOLD * 2
            && Math.abs(a.position.y - DOOR_TARGET.y) < ARRIVAL_THRESHOLD * 2
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

  const roomImage = phase === 'night'
    ? '/rooms/office-night.png'
    : '/rooms/office-day.png'

  return (
    <div className="office-view" data-testid="office-stage">
      <div
        className={`room-container${reducedMotion ? ' reduced-motion' : ''}`}
        style={{
          aspectRatio: '4800/3584',
          width: '100%',
          maxHeight: '100%',
          position: 'relative',
        }}
      >
        <div
          className="room-background"
          style={{ backgroundImage: `url(${roomImage})` }}
        />
        <div
          className="room-background room-background-night"
          style={{
            backgroundImage: 'url(/rooms/office-night.png)',
            opacity: phase === 'night' ? nightOpacity : 0,
          }}
        />

        <FurnitureRenderer
          items={MAIN_ROOM.furniture}
          onItemClick={() => {}}
        />

        {agents.map(agent => (
          <Character
            key={agent.id}
            agent={agent}
            zIndex={
              MAIN_ROOM.agentSpots.find(s => s.id === agent.assignedSpotId)?.zIndex
              ?? Math.round(agent.position.y)
            }
          />
        ))}
      </div>
    </div>
  )
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

      const spot = assignSpot(prev, MAIN_ROOM.agentSpots)
      if (!spot) return prev
      occupied.add(spot.id)

      const agent = createAgent({ id, name, role, task, spot })
      return [...prev, { ...agent, pathQueue: computePath(agent.position, agent.targetPosition) }]
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
        return {
          ...a,
          state: 'completed' as const,
          statusText: status,
          targetPosition: { ...DOOR_TARGET },
          pathQueue: computePath(a.position, DOOR_TARGET),
        }
      })
    }

    case 'mcp_call': {
      const id = ev.agentId
      if (!id) return prev
      // Octo appears at the GitHub desk on git_push (mapped to mcp_call).
      const known = ['octo', 'cron-runner']
      if (known.includes(id) && !prev.some(a => a.id === id)) {
        const spot = assignSpot(prev, MAIN_ROOM.agentSpots)
        if (!spot) return prev
        occupied.add(spot.id)
        const agent = createAgent({
          id, name: id, role: id,
          task: ev.status,
          spot,
        })
        return [...prev, { ...agent, pathQueue: computePath(agent.position, agent.targetPosition) }]
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
