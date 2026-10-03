/**
 * Guest mode — read-only UI.
 *
 * Enabled when:
 *   - URL has `?guest=1` (or `?guest`), or
 *   - localStorage `hermes_guest=1`.
 *
 * In guest mode the chat input is hidden (server also filters private events).
 */
import { useSyncExternalStore } from 'react'

const KEY = 'hermes_guest'

function detectInitial(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has('guest')) {
      const v = params.get('guest')
      const on = v !== '0' && v !== 'false'
      localStorage.setItem(KEY, on ? '1' : '0')
      return on
    }
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let guest = detectInitial()
const listeners = new Set<() => void>()

export function isGuest(): boolean { return guest }

export function setGuest(on: boolean) {
  if (guest === on) return
  guest = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
  if (typeof document !== 'undefined') document.body.classList.toggle('guest-mode', on)
  listeners.forEach(l => l())
}

export function useGuest(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => guest,
    () => false,
  )
}

if (guest && typeof document !== 'undefined') {
  document.body.classList.add('guest-mode')
}
