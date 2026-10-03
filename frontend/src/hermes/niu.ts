/**
 * Niu-mode theme stub — palette + Indonesian strings, persisted to
 * localStorage `niu_mode` (`/niu-mode` chat command toggles it).
 * UI-SPEC.md §7.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'niu_mode'

function load(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

let enabled = load()
const listeners = new Set<() => void>()

function emit() { listeners.forEach(l => l()) }

export function isNiuMode(): boolean { return enabled }

export function setNiuMode(on: boolean) {
  if (enabled === on) return
  enabled = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
  document.body.classList.toggle('niu-mode', on)
  emit()
}

export function toggleNiuMode() { setNiuMode(!enabled) }

export function useNiuMode(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => enabled,
    () => false,
  )
}

// ---- Strings (UI-SPEC.md §7: EN office jokes vs ID santai) ----

const ID_STRINGS = {
  officeTitle: 'Kantor Niu 🏢',
  chatChannel: '#kantor-niu',
  spawn: ['siap kerja!', 'absen masuk', 'gaskeun', 'kopi dulu', 'ayo gas', 'buka vscode...'],
  work: ['lagi push nih', 'commit dulu', 'dalem zona', 'cek docs dulu', 'git blame time', 'stack overflow penyelamat'],
  done: ['beres!', 'udah di-ship', 'PR udah dibuka', 'merge ke main', 'deploy sukses'],
  coffee: ['kopi dulu brb', 'butuh kopi Gayo', 'ambil kopi bentar', 'kopi dulu, kode belakangan'],
}

const EN_STRINGS = {
  officeTitle: 'Hermes Office',
  chatChannel: '#office',
  spawn: ['reporting for duty!', 'clocked in', 'ready to ship', 'coffee first, then code', "let's do this"],
  work: ['on it', 'typing furiously', 'in the zone', 'making progress', 'checking the docs', 'git blame time'],
  done: ['task complete!', 'shipped it', 'PR opened', 'done and dusted', 'LGTM', 'deployed'],
  coffee: ['brb, coffee', 'need caffeine', 'grabbing a cup', 'coffee run'],
}

export type NiuStrings = typeof EN_STRINGS

export function getStrings(): NiuStrings {
  return enabled ? ID_STRINGS : EN_STRINGS
}

// Apply body class once at module load so CSS palette is active before first paint.
if (enabled && typeof document !== 'undefined') {
  document.body.classList.add('niu-mode')
}
