/**
 * The double-envelope bug, pinned.
 *
 * server/index.js has a single broadcast() that hardcodes
 * `{ channel: "event", data: event }`, and server/chat.js calls it with an
 * envelope of its own. The frames below were captured verbatim from a live
 * socket on :7333 — they are not hypotheses.
 *
 * If the server is ever fixed to send flat chat frames, these tests still
 * pass: unwrapFrame leaves an already-flat frame alone.
 */
import { describe, it, expect } from 'vitest'
import { unwrapFrame } from './useOfficeSocket'
import type { ServerFrame } from './types'

const f = (x: unknown) => x as ServerFrame

describe('unwrapFrame', () => {
  it('unwraps the typing frame exactly as the server emits it', () => {
    const wire = f({ channel: 'event', data: { channel: 'typing', data: { sender: 'hermes' } } })
    const out = unwrapFrame(wire)
    expect(out.channel).toBe('typing')
    expect(out.data).toEqual({ sender: 'hermes' })
  })

  it('unwraps chat_done so the transcript is not silently dropped', () => {
    const msg = { id: 5, sender: 'owner', text: 'Kerahkan dua murid.', timestamp: 1 }
    const out = unwrapFrame(f({ channel: 'event', data: { channel: 'chat_done', data: msg } }))
    expect(out.channel).toBe('chat_done')
    expect(out.data).toEqual(msg)
  })

  it('leaves a genuine event alone', () => {
    const ev = { type: 'tool_call', agent: 'hermes', ts: 1 }
    const out = unwrapFrame(f({ channel: 'event', data: ev }))
    expect(out.channel).toBe('event')
    expect(out.data).toEqual(ev)
  })

  it('does NOT unwrap a channel_msg event, which also carries a `channel` field', () => {
    // The trap: a channel_msg names its platform in `channel`. Unwrapping on
    // the mere presence of that key would swallow real audit events.
    const ev = { type: 'channel_msg', channel: 'slack', direction: 'in', ts: 1 }
    const out = unwrapFrame(f({ channel: 'event', data: ev }))
    expect(out.channel).toBe('event')
    expect((out.data as { type: string }).type).toBe('channel_msg')
  })

  it('passes a flat chat frame through untouched', () => {
    const out = unwrapFrame(f({ channel: 'typing', data: { sender: 'a' } }))
    expect(out.channel).toBe('typing')
  })

  it('tolerates null and malformed payloads', () => {
    expect(unwrapFrame(f({ channel: 'event', data: null })).channel).toBe('event')
    expect(unwrapFrame(f({ channel: 'event', data: 'teks' })).channel).toBe('event')
  })
})
