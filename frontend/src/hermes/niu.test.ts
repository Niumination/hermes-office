/**
 * niu.ts — the chrome palette toggle and the UI language.
 *
 * These exist because `load()` used to `return true` unconditionally while
 * `setNiuMode()` kept writing to localStorage. The write was never read, so
 * `/niu-mode` changed the palette, the user reloaded, and the preference was
 * silently gone. Nothing failed; it just quietly did not work, which is the
 * failure mode a test suite is for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('niu-mode palette', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    document.body.className = ''
  })

  it('is on by default — it is the product identity, not an opt-in', async () => {
    const niu = await import('./niu')
    expect(niu.isNiuMode()).toBe(true)
  })

  it('survives a reload once switched off', async () => {
    const a = await import('./niu')
    a.setNiuMode(false)
    expect(a.isNiuMode()).toBe(false)

    vi.resetModules()
    const b = await import('./niu')
    expect(b.isNiuMode()).toBe(false)
  })

  it('survives a reload once switched back on', async () => {
    const a = await import('./niu')
    a.setNiuMode(false)
    a.setNiuMode(true)

    vi.resetModules()
    const b = await import('./niu')
    expect(b.isNiuMode()).toBe(true)
  })

  it('falls back to on for a value it does not recognise', async () => {
    // A half-written or hand-edited key must not leave the UI in a state no
    // code path can produce.
    localStorage.setItem('niu_mode', 'banana')
    const niu = await import('./niu')
    expect(niu.isNiuMode()).toBe(true)
  })

  it('falls back to on when localStorage cannot be read', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const niu = await import('./niu')
    expect(niu.isNiuMode()).toBe(true)
    spy.mockRestore()
  })

  it('toggles both ways', async () => {
    const niu = await import('./niu')
    expect(niu.isNiuMode()).toBe(true)
    niu.toggleNiuMode()
    expect(niu.isNiuMode()).toBe(false)
    niu.toggleNiuMode()
    expect(niu.isNiuMode()).toBe(true)
  })
})

describe('UI language', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('defaults to Indonesian', async () => {
    const niu = await import('./niu')
    expect(niu.getLang()).toBe('id')
    expect(niu.getStrings().chatChannel).toBe('#kantor-niu')
  })

  it('remembers English across a reload', async () => {
    const a = await import('./niu')
    a.setLang('en')
    expect(a.getStrings().chatChannel).toBe('#office')

    vi.resetModules()
    const b = await import('./niu')
    expect(b.getLang()).toBe('en')
  })

  it('keeps both string sets the same shape', async () => {
    // A key present in one language and missing in the other renders as
    // `undefined` in the UI, and only for the users who switched.
    const niu = await import('./niu')
    niu.setLang('id')
    const id = niu.getStrings()
    niu.setLang('en')
    const en = niu.getStrings()
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort())
    for (const k of Object.keys(id) as (keyof typeof id)[]) {
      expect(Array.isArray(id[k])).toBe(Array.isArray(en[k]))
      if (Array.isArray(id[k]) && Array.isArray(en[k])) {
        expect((id[k] as string[]).length).toBeGreaterThan(0)
        expect((en[k] as string[]).length).toBeGreaterThan(0)
      }
    }
  })
})
