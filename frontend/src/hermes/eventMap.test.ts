import { describe, it, expect } from 'vitest'
import { targetRoomFor } from './eventMap'

// --- object-form agent -----------------------------------------------------
//
// The event contract allows `agent` as a bare string OR {name, id, role}.
// The mac relay sends the string; the Hermes cloud hook sends the object.
// targetRoomFor compared the raw value, so every object-form heartbeat
// resolved to UNMAPPED_ROOM — and because the client writes the mapped room
// back over the server's placement, the cloud agent was correctly placed in
// lightvela/root by the server and then displaced by its own heartbeat.

describe('targetRoomFor normalises the agent field', () => {
  it('places a string-form mac heartbeat at the Mac root', () => {
    expect(targetRoomFor({ type: 'agent_status', agent: 'mac' } as never)).toBe('mac/root')
  })

  it('places an object-form cloud heartbeat at the LightVela root', () => {
    expect(
      targetRoomFor({
        type: 'agent_status',
        agent: { name: 'cloud', id: 'cloud', role: 'generalist' },
      } as never),
    ).toBe('lightvela/root')
  })

  it('reads id when name is missing, and never stringifies the object', () => {
    expect(targetRoomFor({ type: 'agent_status', agent: { id: 'mac' } } as never)).toBe('mac/root')
    // The failure mode this replaces: String({}) === '[object Object]'.
    expect(targetRoomFor({ type: 'agent_status', agent: {} } as never)).toBe('belum-dipetakan')
  })

  it('still refuses to invent a room for a machine it does not know', () => {
    expect(targetRoomFor({ type: 'agent_status', agent: 'laptop-tetangga' } as never))
      .toBe('belum-dipetakan')
    expect(targetRoomFor({ type: 'agent_status', agent: { name: 'nobody' } } as never))
      .toBe('belum-dipetakan')
  })
})
