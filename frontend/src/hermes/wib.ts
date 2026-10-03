/**
 * WIB (UTC+7) day/night cycle — UI-SPEC.md §3:
 * 06:00–18:00 WIB = day, otherwise night. Returns fractional day-night
 * opacity (0 = full day, 1 = full night) with smooth dawn/dusk transitions.
 */
import { useEffect, useState } from 'react'

export type WibPhase = 'day' | 'night'

/** Current hour (0-24 float) in WIB regardless of the client's timezone. */
export function wibHourNow(): number {
  const now = new Date()
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000
  const wib = new Date(utcMs + 7 * 3_600_000)
  return wib.getHours() + wib.getMinutes() / 60
}

export function wibPhaseNow(): WibPhase {
  const h = wibHourNow()
  return h >= 6 && h < 18 ? 'day' : 'night'
}

/** Smooth transition window (hours) around the 06:00 and 18:00 boundaries. */
const TRANSITION_H = 0.75

export function nightOpacityNow(): number {
  const h = wibHourNow()
  // Day core: 06:45–17:15 → 0. Night core: 00:00–05:15 & 18:45–24 → 1.
  // Around the boundaries: linear fade.
  if (h >= 6 + TRANSITION_H && h < 18 - TRANSITION_H) return 0
  if (h < 6 - TRANSITION_H || h >= 18 + TRANSITION_H) return 1
  if (h >= 6 - TRANSITION_H && h < 6 + TRANSITION_H) {
    // dawn: fading night → day (1 → 0)
    return 1 - (h - (6 - TRANSITION_H)) / (2 * TRANSITION_H)
  }
  // dusk: fading day → night (0 → 1)
  return (h - (18 - TRANSITION_H)) / (2 * TRANSITION_H)
}

export function useWibCycle(): { phase: WibPhase; nightOpacity: number; label: string } {
  const [state, setState] = useState(() => ({
    phase: wibPhaseNow(),
    nightOpacity: nightOpacityNow(),
    label: wibLabel(),
  }))

  useEffect(() => {
    const id = setInterval(() => {
      setState({ phase: wibPhaseNow(), nightOpacity: nightOpacityNow(), label: wibLabel() })
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  return state
}

function wibLabel(): string {
  const h = Math.floor(wibHourNow())
  const m = Math.round((wibHourNow() - h) * 60)
  return `WIB ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
