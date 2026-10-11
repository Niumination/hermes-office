/**
 * Segel — the seal is an integrity claim shown to a buyer, which makes a false
 * "tersegel" the most expensive bug this UI can have. Three ways it could
 * lie are pinned here:
 *
 *   1. Reporting chain-ok as trustworthy when the anchors disagree.
 *   2. Advertising an audit log to a viewer the server refuses.
 *   3. Reporting a ledger that is switched off as a ledger that is broken.
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Seal from './Seal'

const HEAD = { seq: 42, hash: 'a'.repeat(64), records: 42 }

function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k))
    const r = key ? routes[key]! : { status: 404 }
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body,
    } as Response
  })
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Seal', () => {
  it('renders nothing at all to a viewer the server refuses', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ledger/head': { status: 403 } }))
    const { container } = render(<Seal />)
    // Not "disabled", not "403" — absent. Showing a locked control would
    // advertise an audit log the guest cannot read.
    await waitFor(() => expect(container.querySelector('.sect-chain')).toBeNull())
  })

  it('does not claim a seal when the anchors disagree with an intact chain', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ledger/head': { body: HEAD },
      '/ledger/verify': {
        body: {
          ok: true, trustworthy: false, checked: 42, tookMs: 3,
          anchors: { ok: false, strength: 'weak', anchors: 2 },
        },
      },
    }))
    const { container } = render(<Seal />)
    await waitFor(() => expect(screen.getByText(/42 catatan/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByText('Verifikasi rantai'))
    await waitFor(() => expect(screen.getByText(/jangan anggap tersegel/)).toBeTruthy())
    expect(screen.queryByText(/^Tersegel:/)).toBeNull()
    // And the indicator must agree with the sentence. Asserting only the text
    // let a mutant through that kept the headline dot green while the verdict
    // below it said the anchors disagreed.
    expect(container.querySelector('.sect-chain--sealed')).toBeNull()
    expect(container.querySelector('.sect-chain--broken')).toBeTruthy()
    expect(container.querySelector('.sect-chain__verdict.bad')).toBeTruthy()
  })

  it('says tersegel only when the chain and the anchors both hold', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ledger/head': { body: HEAD },
      '/ledger/verify': {
        body: {
          ok: true, trustworthy: true, checked: 42, tookMs: 3,
          anchors: { ok: true, strength: 'strong', anchors: 2 },
        },
      },
    }))
    const { container: container2 } = render(<Seal />)
    await waitFor(() => expect(screen.getByText(/42 catatan/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByText('Verifikasi rantai'))
    await waitFor(() => expect(screen.getByText(/Tersegel: 42 catatan/)).toBeTruthy())
    expect(container2.querySelector('.sect-chain--sealed')).toBeTruthy()
  })

  it('distinguishes a ledger that is off from a ledger that is broken', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ledger/head': { status: 503 } }))
    render(<Seal />)
    await waitFor(() => expect(screen.getByText(/—/)).toBeTruthy())
    expect(screen.queryByText('RANTAI PUTUS')).toBeTruthy()
  })

  it('publishes the head hash in full, because a truncated hash is useless', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ledger/head': { body: HEAD } }))
    const { container } = render(<Seal />)
    await waitFor(() => expect(screen.getByText(/42 catatan/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const code = container.querySelector('.sect-chain__hash')!
    expect(code.textContent).toHaveLength(64)
    expect(code.textContent).toBe(HEAD.hash)
  })

  it('keeps the last known value when a poll throws, instead of flashing an alarm', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) return { ok: true, status: 200, json: async () => HEAD } as Response
      throw new Error('network blip')
    }))
    render(<Seal pollMs={5} />)
    await waitFor(() => expect(screen.getByText(/42 catatan/)).toBeTruthy())
    await vi.advanceTimersByTimeAsync(40)
    expect(screen.getByText(/42 catatan/)).toBeTruthy()
    expect(screen.queryByText('RANTAI PUTUS')).toBeNull()
  })
})
