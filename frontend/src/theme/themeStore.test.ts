import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getTheme, setTheme, applyTheme, resetThemeForTests,
} from './themeStore'

/**
 * The store has one job with three places to keep in sync: the React value,
 * <html data-theme>, and localStorage. The tests that matter are the ones
 * where the third place misbehaves, because that is the case a real browser
 * will produce and a happy-path test will never see.
 */

beforeEach(() => {
  resetThemeForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetThemeForTests()
})

describe('theme store', () => {
  it('puts the theme on <html> where the CSS can see it', () => {
    setTheme('sect')
    expect(document.documentElement.getAttribute('data-theme')).toBe('sect')
    setTheme('default')
    expect(document.documentElement.getAttribute('data-theme')).toBe('default')
  })

  it('remembers the choice', () => {
    setTheme('sect')
    expect(localStorage.getItem('hermes.theme')).toBe('sect')
    expect(getTheme()).toBe('sect')
  })

  it('survives a localStorage that throws', () => {
    // Safari in private mode does exactly this. Losing the preference is
    // acceptable; throwing out of a click handler is not.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(() => setTheme('sect')).not.toThrow()
    expect(getTheme()).toBe('sect')
    expect(document.documentElement.getAttribute('data-theme')).toBe('sect')
  })

  it('ignores a stored value that is not a theme', () => {
    // Anyone can type into localStorage from the console; a junk value must
    // not reach the data-theme attribute and style the page as nothing.
    localStorage.setItem('hermes.theme', 'dragon-mode')
    applyTheme()
    expect(getTheme()).toBe('default')
  })

  it('applies the remembered theme without anyone clicking', () => {
    setTheme('sect')
    document.documentElement.removeAttribute('data-theme')
    applyTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('sect')
  })
})
