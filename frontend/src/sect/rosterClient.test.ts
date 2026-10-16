/**
 * The roster is the third source of "who exists", and the one the frontend
 * never read. These tests pin the two properties that matter:
 *
 *   - it parses what the live server actually sends (`{agents:[{name,role}]}`),
 *     not a shape invented here;
 *   - it never throws. The office must keep drawing what it already knows
 *     when this fetch fails, because a roster is an enrichment, not a
 *     load-bearing surface.
 */
import { describe, it, expect } from 'vitest'
import { fetchRoster } from './rosterClient'

const res = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as unknown as Response

const fetchOf = (body: unknown, ok = true) =>
  (async () => res(body, ok)) as unknown as typeof fetch

describe('fetchRoster', () => {
  it('parses the shape the live server sends', async () => {
    // Captured verbatim from dash.abstract.biz.id/roster.
    const out = await fetchRoster(fetchOf({
      agents: [
        { name: 'cloud', role: 'generalist' },
        { name: 'mac', role: 'generalist' },
        { name: 'boss', role: 'reviewer' },
      ],
      server: '1.0',
    }))
    expect(out.map((a) => a.id)).toEqual(['cloud', 'mac', 'boss'])
    expect(out[2]?.role).toBe('reviewer')
  })

  it('keeps an agent whose role the server omitted', async () => {
    const out = await fetchRoster(fetchOf({ agents: [{ name: 'lone' }] }))
    expect(out).toEqual([{ id: 'lone', role: undefined }])
  })

  it('drops entries with no usable name rather than rendering a blank figure', async () => {
    const out = await fetchRoster(fetchOf({
      agents: [{ name: '' }, { name: '   ' }, { role: 'x' }, { name: 'real' }],
    }))
    expect(out.map((a) => a.id)).toEqual(['real'])
  })

  it('returns empty when the server refuses, instead of throwing into render', async () => {
    expect(await fetchRoster(fetchOf({}, false))).toEqual([])
  })

  it('returns empty when agents is missing or not a list', async () => {
    expect(await fetchRoster(fetchOf({}))).toEqual([])
    expect(await fetchRoster(fetchOf({ agents: 'nope' }))).toEqual([])
  })

  it('returns empty when the network fails outright', async () => {
    const boom = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await fetchRoster(boom)).toEqual([])
  })

  it('sends credentials, or the server answers as an anonymous stranger', async () => {
    let init: RequestInit | undefined
    const spy = (async (_u: string, i?: RequestInit) => {
      init = i
      return res({ agents: [] })
    }) as unknown as typeof fetch
    await fetchRoster(spy)
    expect(init?.credentials).toBe('include')
  })
})
