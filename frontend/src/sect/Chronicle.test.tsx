/**
 * Babad — the chronicle is the audit story, which makes two of its behaviours
 * contractual rather than cosmetic:
 *
 *   1. docs/PRIVACY.md: a `channel_msg` may show platform and direction and
 *      must never show content. A leak here is a product-breaking bug.
 *   2. docs/EVENTS.md: clients must tolerate unknown event types. The old UI
 *      "tolerated" them by dropping them, which quietly turned an audit log
 *      into a filtered one.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Chronicle } from './Chronicle'
import type { HermesEnvelope } from '../hermes/types'

const at = (ts: number, e: Partial<HermesEnvelope>): HermesEnvelope =>
  ({ ts, ...e }) as HermesEnvelope

describe('Chronicle', () => {
  it('never renders the body of a channel message', () => {
    const secret = 'nomor kartu 4111 1111 1111 1111'
    render(<Chronicle events={[at(0, {
      type: 'channel_msg', platform: 'whatsapp', channelType: 'dm',
      direction: 'inbound', text: secret, body: secret, content: secret,
    })]} />)
    expect(screen.queryByText(new RegExp(secret))).toBeNull()
    expect(screen.getByText(/whatsapp/)).toBeTruthy()
    expect(screen.getByText(/dm inbound/)).toBeTruthy()
  })

  it('renders an event type it has never heard of', () => {
    render(<Chronicle events={[at(0, { type: 'quantum_flux', weird: true })]} />)
    expect(screen.getByText('quantum_flux')).toBeTruthy()
  })

  it('does not throw when fields are missing or the wrong type', () => {
    expect(() => render(<Chronicle events={[
      at(0, { type: 'tool_call' }),
      at(0, { type: 'git_push', commits: 'banyak', author: null }),
      at(0, { type: 'agent_spawned', agent: 'bukan objek' }),
      at(0, { type: 'agent_finished' }),
      { type: 'cron_fired' } as HermesEnvelope,
    ]} />)).not.toThrow()
  })

  it('names the actor and the work for a normal tool call', () => {
    render(<Chronicle events={[at(0, {
      type: 'tool_call', agentId: 'niu-1', tool: 'Bash', detail: 'npm test',
    })]} />)
    expect(screen.getByText('niu-1')).toBeTruthy()
    expect(screen.getByText('memanggil Bash npm test')).toBeTruthy()
  })

  it('shows a dash rather than a wrong clock when there is no timestamp', () => {
    render(<Chronicle events={[{ type: 'cron_fired', job: 'backup' } as HermesEnvelope]} />)
    expect(screen.getByText('--:--')).toBeTruthy()
  })

  it('says the record is empty instead of showing a blank column', () => {
    render(<Chronicle events={[]} />)
    expect(screen.getByText(/belum ada/i)).toBeTruthy()
  })
})
