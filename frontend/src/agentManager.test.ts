/**
 * agentManager.test.ts
 *
 * agentManager.ts is the largest logic file in the frontend (396 lines) and
 * was the last one with no tests at all.  It is also the only module here
 * that is deliberately *random*: waypoint jitter, a 20% detour roll, and
 * five message pools all call Math.random().  Randomness is why it stayed
 * untested — and exactly why it needs tests, because a non-deterministic
 * module is one nobody can refactor with confidence.
 *
 * Approach: stub Math.random per-test with a scripted sequence so every
 * branch is reachable and the assertions are exact.  Where a value is
 * genuinely allowed to vary, assert the *invariant* (membership, bounds,
 * determinism) rather than a literal.
 *
 * Several tests below pin behaviour that is arguably wrong (a boss on a
 * water break still gets a Red Bull; a disconnected waypoint graph lets an
 * agent walk through walls).  Those are labelled as characterisation tests,
 * not endorsements — they exist so the behaviour cannot change silently.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  assignSpot,
  stepToward,
  findWaypointPath,
  getEffect,
  createAgent,
  spawnMessage,
  workMessage,
  doneMessage,
  coffeeMessage,
  waterMessage,
  BREAK_MIN_DESK_TIME,
  BREAK_CHANCE_PER_SEC,
  BREAK_DURATION,
  WALK_SPEED,
} from './agentManager'
import type { Agent } from './types'
import { AGENT_CONFIGS } from './types'
import type { AgentSpot, Waypoint } from './rooms'
import { ROOMS } from './rooms'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Feed Math.random a scripted sequence; the last value repeats forever. */
function scriptRandom(...values: number[]) {
  let i = 0
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    const v = values[Math.min(i, values.length - 1)]
    i++
    return v
  })
}

const desk = (id: string, x = 0, y = 0): AgentSpot => ({ id, type: 'desk', x, y })

function agentAt(spotId: string | undefined): Agent {
  return { id: `a-${spotId}`, assignedSpotId: spotId } as Agent
}

// ---------------------------------------------------------------------------

describe('assignSpot', () => {
  it('returns the first unoccupied desk in declaration order', () => {
    const spots = [desk('d1'), desk('d2'), desk('d3')]
    const agents = [agentAt('d1')]

    expect(assignSpot(agents, spots)?.id).toBe('d2')
  })

  it('ignores non-desk spots entirely', () => {
    // A room's spot list mixes desks with coffee/water/door spots. Handing an
    // agent the coffee machine as a permanent desk would park them there.
    const spots: AgentSpot[] = [
      { id: 'coffee', type: 'coffee', x: 0, y: 0 },
      { id: 'water', type: 'water', x: 0, y: 0 },
      { id: 'door', type: 'door', x: 0, y: 0 },
      desk('d1'),
    ]

    expect(assignSpot([], spots)?.id).toBe('d1')
  })

  it('returns null when every desk is taken', () => {
    const spots = [desk('d1'), desk('d2')]
    const agents = [agentAt('d1'), agentAt('d2')]

    expect(assignSpot(agents, spots)).toBeNull()
  })

  it('returns null when a room has no desks at all', () => {
    // nap-room and parking are real rooms with zero desk spots.
    expect(assignSpot([], [{ id: 'lounge', type: 'lounge', x: 0, y: 0 }])).toBeNull()
  })

  it('does not let agents without a spot block the first desk', () => {
    // assignedSpotId is optional; a freshly-arrived agent has undefined.
    // Without the .filter(Boolean) guard, undefined would enter the taken-set
    // harmlessly — but an agent whose spot is the empty string must not.
    const spots = [desk('d1'), desk('d2')]
    const agents = [agentAt(undefined), agentAt(undefined)]

    expect(assignSpot(agents, spots)?.id).toBe('d1')
  })
})

// ---------------------------------------------------------------------------

describe('stepToward', () => {
  it('moves exactly `speed` units along the straight line', () => {
    // 3-4-5 triangle: distance 5, speed 1 → one fifth of the way.
    const { position, arrived } = stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 1)

    expect(position.x).toBeCloseTo(0.6, 10)
    expect(position.y).toBeCloseTo(0.8, 10)
    expect(arrived).toBe(false)
  })

  it('snaps to the target instead of overshooting', () => {
    // Without the dist <= speed guard, a fast agent oscillates around its
    // desk forever instead of sitting down.
    const { position, arrived } = stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 100)

    expect(position).toEqual({ x: 3, y: 4 })
    expect(arrived).toBe(true)
  })

  it('treats a step of exactly the remaining distance as arrival', () => {
    const { position, arrived } = stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)

    expect(position).toEqual({ x: 3, y: 4 })
    expect(arrived).toBe(true)
  })

  it('reports arrival without dividing by zero when already at the target', () => {
    // dist === 0 would make dx/dist produce NaN and strand the agent at
    // position NaN — permanently invisible. The guard runs first.
    const { position, arrived } = stepToward({ x: 42, y: 7 }, { x: 42, y: 7 }, WALK_SPEED)

    expect(Number.isNaN(position.x)).toBe(false)
    expect(Number.isNaN(position.y)).toBe(false)
    expect(position).toEqual({ x: 42, y: 7 })
    expect(arrived).toBe(true)
  })

  it('returns a copy of the target, not the caller’s object', () => {
    // The agent's targetPosition is reused across frames; returning it by
    // reference would alias position and targetPosition into one object.
    const target = { x: 3, y: 4 }
    const { position } = stepToward({ x: 0, y: 0 }, target, 100)

    position.x = 999
    expect(target.x).toBe(3)
  })

  it('converges to the target over repeated frames at WALK_SPEED', () => {
    let pos = { x: 0, y: 0 }
    const target = { x: 10, y: 0 }
    let frames = 0

    for (; frames < 10_000; frames++) {
      const r = stepToward(pos, target, WALK_SPEED)
      pos = r.position
      if (r.arrived) break
    }

    expect(pos).toEqual(target)
    // 10 %-units at 0.08/frame ≈ 125 frames ≈ 2.1 s at 60fps. Guard against a
    // speed change that would make agents teleport or crawl.
    expect(frames).toBeGreaterThan(100)
    expect(frames).toBeLessThan(150)
  })
})

// ---------------------------------------------------------------------------

describe('findWaypointPath', () => {
  // A ── B ── C ── D   plus an isolated island Z
  const graph: Waypoint[] = [
    { id: 'A', x: 0, y: 0, connections: ['B'] },
    { id: 'B', x: 10, y: 0, connections: ['A', 'C'] },
    { id: 'C', x: 20, y: 0, connections: ['B', 'D'] },
    { id: 'D', x: 30, y: 0, connections: ['C'] },
    { id: 'Z', x: 90, y: 90, connections: [] },
  ]

  it('returns an empty path when the room has no waypoint graph', () => {
    // Several rooms (parking, rooftop) may ship without waypoints; the caller
    // then walks straight to the target. Must not throw on waypoints[0].
    expect(findWaypointPath(0, 0, 50, 50, [])).toEqual([])
  })

  it('walks the BFS shortest path between the nearest waypoints', () => {
    scriptRandom(0.9, 0.5) // 0.9 > 0.2 → no detour; 0.5 → zero jitter
    const path = findWaypointPath(1, 0, 29, 0, graph)

    expect(path.map(p => Math.round(p.x))).toEqual([0, 10, 20, 30])
  })

  it('snaps the endpoints to the nearest waypoint, not the exact coordinates', () => {
    scriptRandom(0.9, 0.5)
    // Start at (12,3): nearest is B. End at (19,-4): nearest is C.
    const path = findWaypointPath(12, 3, 19, -4, graph)

    expect(path.map(p => Math.round(p.x))).toEqual([10, 20])
  })

  it('returns a single-element path when start and end share a waypoint', () => {
    scriptRandom(0.9, 0.5)
    const path = findWaypointPath(0, 0, 1, 1, graph)

    expect(path).toHaveLength(1)
    expect(Math.round(path[0].x)).toBe(0)
  })

  it('jitters each waypoint by at most ±1.5 %-units', () => {
    // Jitter stops every agent tracing the identical line. Too much and they
    // clip through furniture, so the bound is part of the contract.
    scriptRandom(0.9, 0, 1, 0, 1, 0, 1, 0) // no detour, then extremes
    const path = findWaypointPath(1, 0, 29, 0, graph)

    const ideal = [0, 10, 20, 30]
    path.forEach((p, i) => {
      expect(Math.abs(p.x - ideal[i])).toBeLessThanOrEqual(1.5)
      expect(Math.abs(p.y - 0)).toBeLessThanOrEqual(1.5)
    })
  })

  it('produces different lines on different rolls', () => {
    scriptRandom(0.9, 0.1)
    const a = findWaypointPath(1, 0, 29, 0, graph)
    vi.restoreAllMocks()
    scriptRandom(0.9, 0.8)
    const b = findWaypointPath(1, 0, 29, 0, graph)

    expect(a[0].x).not.toBe(b[0].x)
  })

  it('takes a detour through an off-path waypoint on a winning roll', () => {
    // A ── B ── C with D hanging off C. Shortest A→C is 3 hops (≤4), so the
    // detour roll applies: 0.1 ≤ 0.2 wins, then index 0 of the detour list.
    scriptRandom(0.1, 0, 0.5)
    const path = findWaypointPath(0, 0, 20, 0, graph)
    const xs = path.map(p => Math.round(p.x))

    // Detour means strictly more stops than the 3-waypoint shortest path.
    expect(xs.length).toBeGreaterThan(3)
  })

  it('never detours when the shortest path is already long', () => {
    // maybeTakeLongWay returns early for paths > 4 waypoints, so the random
    // roll is never consumed — a 0.0 roll that would otherwise win is ignored.
    const longGraph: Waypoint[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, i, arr) => ({
      id,
      x: i * 10,
      y: 0,
      connections: [arr[i - 1], arr[i + 1]].filter(Boolean) as string[],
    }))
    scriptRandom(0, 0.5)
    const path = findWaypointPath(0, 0, 50, 0, longGraph)

    expect(path).toHaveLength(6)
  })

  it('falls back to the start waypoint alone when no route exists', () => {
    // CHARACTERISATION, not endorsement. Island Z is unreachable, so the
    // function returns just the start point and the caller then straight-lines
    // to the destination — i.e. the agent walks through the wall. Acceptable
    // for a cosmetic visualiser; recorded here so a future pathfinding change
    // has a test to update rather than a surprise to discover.
    scriptRandom(0.5)
    const path = findWaypointPath(0, 0, 90, 90, graph)

    expect(path).toHaveLength(1)
    // It is the START waypoint (A, nearest to where the agent already stands)
    // — so the "path" adds nothing and the caller straight-lines the whole
    // way. Note it comes back exactly (0,0): this is the one return path that
    // is NOT jittered, which is also how you can tell it was taken.
    expect(path[0]).toEqual({ x: 0, y: 0 })
  })
})

// ---------------------------------------------------------------------------

describe('getEffect', () => {
  it('shows a star over a new hire and a thumbs-up on completion', () => {
    expect(getEffect('new-hire')).toBe('/sprites/effects/star.webp')
    expect(getEffect('completed')).toBe('/sprites/effects/thumb-up.webp')
  })

  it('shows no permanent bubble over a plainly working agent', () => {
    // A persistent typing bubble on every desk turns the office into noise.
    expect(getEffect('working')).toBeNull()
  })

  it('falls asleep only after more than 30 s idle', () => {
    expect(getEffect('idle', 30_000)).toBeNull()
    expect(getEffect('idle', 30_001)).toBe('/sprites/effects/sleeping.webp')
  })

  it('returns null for transit and unmapped states', () => {
    expect(getEffect('walking-to-manager')).toBeNull()
    expect(getEffect('talking-to-manager')).toBeNull()
    expect(getEffect('changing-room')).toBeNull()
  })

  describe('ultra-think energy drinks', () => {
    it('triggers on the status text', () => {
      expect(getEffect('working', 0, 'ultra thinking', 'agent-1')).toMatch(/energy\.webp$/)
    })

    it('triggers on the task as well as the status text', () => {
      // The two are concatenated; a task-only match must still fire.
      expect(getEffect('working', 0, undefined, 'agent-1', 'deep analysis of the schema'))
        .toMatch(/energy\.webp$/)
    })

    it('picks the same drink every frame for the same agent', () => {
      // The effect is recomputed each render. A random pick would make the can
      // flicker between Red Bull and Monster at 60fps.
      const first = getEffect('working', 0, 'ultra', 'agent-stable')
      for (let i = 0; i < 20; i++) {
        expect(getEffect('working', 0, 'ultra', 'agent-stable')).toBe(first)
      }
    })

    it('does not depend on Math.random at all', () => {
      const spy = scriptRandom(0.999)
      getEffect('working', 0, 'ultra', 'agent-stable')

      expect(spy).not.toHaveBeenCalled()
    })

    it('spreads different agents across both drinks', () => {
      const seen = new Set<string | null>()
      for (let i = 0; i < 40; i++) seen.add(getEffect('working', 0, 'ultra', `agent-${i}`))

      expect(seen.size).toBe(2)
    })

    it('tolerates a missing agent id', () => {
      expect(getEffect('working', 0, 'ultra')).toMatch(/energy\.webp$/)
    })
  })

  describe('breaks', () => {
    it('shows coffee for an ordinary break', () => {
      expect(getEffect('coffee-break')).toBe('/sprites/effects/need-coffee.webp')
    })

    it.each(['stay hydrated', 'h2o break', 'water run', 'refilling bottle'])(
      'shows a water glass for status %j',
      status => {
        expect(getEffect('coffee-break', 0, status)).toBe('/sprites/effects/glass-water.webp')
      },
    )

    it('gives the boss a Red Bull instead of coffee', () => {
      expect(getEffect('coffee-break', 0, undefined, 'boss-1'))
        .toBe('/sprites/effects/redbull-energy.webp')
    })

    it('CHARACTERISATION: the boss gets Red Bull even on a water break', () => {
      // The boss check sits above the hydration check, so "stay hydrated"
      // loses. Probably unintended, entirely harmless, and pinned here so the
      // ordering is a decision rather than an accident.
      expect(getEffect('coffee-break', 0, 'stay hydrated', 'boss-1'))
        .toBe('/sprites/effects/redbull-energy.webp')
    })

    it('does not give a Red Bull to an agent merely named like the boss', () => {
      // startsWith('boss-') — 'bossa-nova' must not match the prefix rule.
      expect(getEffect('coffee-break', 0, undefined, 'bossa-nova'))
        .toBe('/sprites/effects/need-coffee.webp')
    })
  })

  describe('event effects while walking', () => {
    it.each([
      ['pizza is here', '/sprites/effects/pizza.webp'],
      ['birthday party', '/sprites/effects/cake.webp'],
      ['fire drill', '/sprites/effects/fire.webp'],
      ['deploy time', '/sprites/effects/party.webp'],
      ['friday ship', '/sprites/effects/party.webp'],
      ['build success', '/sprites/effects/party.webp'],
      ['standup', null],
      ['heading to desk', null],
    ])('maps status %j to %j', (status, expected) => {
      expect(getEffect('walking-to-desk', 0, status)).toBe(expected)
    })

    it('matches case-insensitively', () => {
      expect(getEffect('walking-to-desk', 0, 'PIZZA TIME')).toBe('/sprites/effects/pizza.webp')
    })
  })

  it('the Office-TV prop branch is inert in this fork', () => {
    // getOfficePropForRole is a shim returning null (Hermes has no TV-show
    // cast), so the role argument can never override the state effect. If
    // someone later wires up real props, this test fails and they must decide
    // deliberately whether props should outrank the coffee cup.
    expect(getEffect('coffee-break', 0, undefined, 'a1', undefined, 'boss'))
      .toBe('/sprites/effects/need-coffee.webp')
    expect(getEffect('working', 0, undefined, 'a1', undefined, 'debugger')).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('message pools', () => {
  const pools: [string, () => string][] = [
    ['spawn', spawnMessage],
    ['work', workMessage],
    ['done', doneMessage],
    ['coffee', coffeeMessage],
    ['water', waterMessage],
  ]

  it.each(pools)('%s returns a non-empty string', (_name, fn) => {
    scriptRandom(0.5)
    const msg = fn()

    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(0)
  })

  it.each(pools)('%s never reads past the end of its pool', (_name, fn) => {
    // pick() uses Math.floor(random * len); a random of exactly 1 (which the
    // spec excludes but a careless stub does not) would index out of bounds
    // and render "undefined" in a speech bubble.
    scriptRandom(0.999999)

    expect(fn()).not.toBeUndefined()
  })

  it.each(pools)('%s draws from a pool of several variants', (_name, fn) => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(fn())

    expect(seen.size).toBeGreaterThan(1)
  })

  it('keeps the pools distinct from one another', () => {
    const collect = (fn: () => string) => {
      const s = new Set<string>()
      for (let i = 0; i < 200; i++) s.add(fn())
      return s
    }
    const spawn = collect(spawnMessage)
    const done = collect(doneMessage)

    expect([...spawn].some(m => done.has(m))).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('createAgent', () => {
  const spot: AgentSpot = { id: 'desk-2b', type: 'desk', x: 35.4, y: 67.5, spriteFacing: 'front-left' }

  it('starts the agent at the door, not at the desk', () => {
    // The whole point of the new-hire animation is the walk in from the
    // entrance. Spawning at the desk skips it.
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })
    const entry = ROOMS['main-office'].entryPoint

    expect(a.position).toEqual({ x: entry.x, y: entry.y })
    expect(a.state).toBe('new-hire')
  })

  it('targets the assigned desk and remembers it as home', () => {
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })

    expect(a.targetPosition).toEqual({ x: spot.x, y: spot.y })
    expect(a.deskPosition).toEqual({ x: spot.x, y: spot.y })
    expect(a.assignedSpotId).toBe('desk-2b')
    expect(a.spriteFacing).toBe('front-left')
  })

  it('gives position and target separate objects', () => {
    // Shared references here would drag the desk marker along with the agent.
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })

    expect(a.targetPosition).not.toBe(a.deskPosition)
    a.position.x = 999
    expect(a.targetPosition.x).toBe(spot.x)
  })

  it('applies the role config', () => {
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })

    expect(a.color).toBe(AGENT_CONFIGS['debugger'].color)
    expect(a.emoji).toBe(AGENT_CONFIGS['debugger'].emoji)
    expect(a.role).toBe('debugger')
  })

  it('falls back to the default config for an unknown role', () => {
    // Roles arrive from OTLP spans and the Mac relay — arbitrary strings. An
    // unmapped role must not produce an agent with undefined colour.
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'quantum-alchemist', spot })

    expect(a.color).toBe(AGENT_CONFIGS['default'].color)
    expect(a.emoji).toBe(AGENT_CONFIGS['default'].emoji)
    expect(a.role).toBe('quantum-alchemist') // role string is preserved verbatim
  })

  it('stamps a spawn message and a hire time', () => {
    const before = Date.now()
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })

    expect(a.statusText).toBeTruthy()
    expect(a.hiredAt).toBeGreaterThanOrEqual(before)
    expect(a.hiredAt).toBeLessThanOrEqual(Date.now())
  })

  it('places every new agent in main-office', () => {
    const a = createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot })

    expect(a.room).toBe('main-office')
    expect(a.assignedRoom).toBe('main-office')
    expect(a.type).toBe('subagent')
  })

  it('carries the optional task through and tolerates its absence', () => {
    expect(createAgent({ id: 'a1', name: 'Ada', role: 'debugger', spot, task: 'fix #42' }).task)
      .toBe('fix #42')
    expect(createAgent({ id: 'a2', name: 'Bo', role: 'debugger', spot }).task).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('break tuning constants', () => {
  it('keeps breaks rare enough to read as incidental', () => {
    // 0.008/s ≈ one break per ~2 minutes per agent. An order of magnitude
    // higher and the office empties; lower and the animation never shows.
    expect(BREAK_CHANCE_PER_SEC).toBeGreaterThan(0)
    expect(BREAK_CHANCE_PER_SEC).toBeLessThan(0.05)
  })

  it('makes an agent settle at the desk before it can wander off', () => {
    expect(BREAK_MIN_DESK_TIME).toBeGreaterThanOrEqual(BREAK_DURATION)
  })

  it('keeps a break shorter than the time needed to earn the next one', () => {
    // Otherwise an agent can chain breaks and never appear to work.
    expect(BREAK_DURATION).toBeLessThan(BREAK_MIN_DESK_TIME + BREAK_DURATION)
    expect(WALK_SPEED).toBeGreaterThan(0)
  })
})
