/**
 * Niu-mode theme stub — palette + Indonesian strings, persisted to
 * localStorage `niu_mode` (`/niu-mode` chat command toggles it).
 * UI-SPEC.md §7.
 */
import { useSyncExternalStore } from 'react'

// LightVela default: UI Bahasa Indonesia. /niu-mode mengganti ke EN.
// Toggle terbalik dari versi lama (dulu default EN): disimpan ke key
// localStorage terpisah `niu_mode_lang` supaya pengguna lama tidak terjebak
// di preferensi lama, dan default baru (ID) menang untuk pengunjung baru.

const KEY = 'niu_mode'
const LANG_KEY = 'niu_mode_lang'

/** Bahasa UI aktif: 'id' (default) atau 'en' (via /niu-mode). */
type Lang = 'id' | 'en'

function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'id'
  } catch { return 'id' }
}

let lang: Lang = loadLang()

function load(): boolean {
  // `niu_mode` lama mengaktifkan tema+palette Niu; sekarang selalu aktif
  // (itulah identitas visual LightVela), jadi selalu true.
  return true
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

/** Beralih antara Bahasa Indonesia (default) dan English. */
export function setLang(next: Lang) {
  if (lang === next) return
  lang = next
  try { localStorage.setItem(LANG_KEY, next) } catch {}
  emit()
}

/** 'id' atau 'en'. Default 'id'. */
export function getLang(): Lang { return lang }

export function toggleLang() { setLang(lang === 'id' ? 'en' : 'id') }

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => lang,
    () => 'id' as Lang,
  )
}

export function useNiuMode(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => enabled,
    () => false,
  )
}

// ---- Strings (UI-SPEC.md §7: EN office jokes vs ID santai) ----
// Default ID: produk LightVela pakai Bahasa Indonesia di UI/UX.
// EN tetap tersedia via /niu-mode toggle (en-mode); ID tetap default.

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
  return lang === 'en' ? EN_STRINGS : ID_STRINGS
}

// Apply body class once at module load so CSS palette is active before first paint.
if (enabled && typeof document !== 'undefined') {
  document.body.classList.add('niu-mode')
}
