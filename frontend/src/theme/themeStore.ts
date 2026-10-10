import { useSyncExternalStore } from 'react'
import type { ThemeId } from './plates'

/**
 * Where the chosen theme lives.
 *
 * WHY A STORE AND NOT CONTEXT
 * ---------------------------
 * Two widely separated things need the theme: the toggle in the topbar and
 * the plate lookup deep inside OfficeStage. Threading a provider between
 * them would mean touching every component on the path for a value none of
 * them care about. `useSyncExternalStore` is React's own answer to exactly
 * this, and it keeps the theme readable from outside React too.
 *
 * The attribute on <html> is the real source of truth for CSS -- sect.css
 * scopes everything under [data-theme="sect"] -- so the store's job is to
 * keep that attribute, localStorage and React in agreement.
 *
 * Every storage access is wrapped: Safari in private mode throws on
 * localStorage, and a governance dashboard that white-screens because it
 * could not remember a colour scheme would be an embarrassing way to fail.
 */

const KEY = 'hermes.theme'
const THEMES: readonly ThemeId[] = ['default', 'sect']
// Default untuk situs publik adalah 宗門: inilah identitas visual produk,
// dan pengunjung tidak punya cara tahu ada tombol yang harus ditekan.
// Tombol ThemeToggle tetap mematikannya, dan preferensi tersimpan jadi
// pengunjung yang memilih "Office" tidak melihatnya lagi.
const DEFAULT_THEME: ThemeId = 'sect'

const listeners = new Set<() => void>()

function readStored(): ThemeId {
  try {
    const raw = localStorage.getItem(KEY)
    return (THEMES as readonly string[]).includes(raw ?? '')
      ? (raw as ThemeId)
      : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

let current: ThemeId = readStored()

/** Push the theme onto <html> so CSS can see it. Safe to call repeatedly. */
export function applyTheme(theme: ThemeId = current): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

export function getTheme(): ThemeId {
  return current
}

export function setTheme(theme: ThemeId): void {
  current = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // An unremembered preference is a smaller problem than a crash.
  }
  applyTheme(theme)
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useTheme(): ThemeId {
  // getServerSnapshot: default yang sama dengan readStored, supaya SSR/CSR
  // tidak berkedip ke tema lain saat hidrasi.
  return useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME)
}

/** Test seam: forget everything this module remembered. */
export function resetThemeForTests(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  current = DEFAULT_THEME
  applyTheme(DEFAULT_THEME)
  listeners.clear()
}
