// Which plate does a room draw, under which theme?
//
// The sect theme has art for the eight rooms the floor-plan policy governs.
// It has none for parking, rooftop, gym or manager-office — those are not
// sect halls, so inventing art for them would be inventing a hierarchy the
// policy does not have.
//
// That means the resolver MUST fall back, and the fallback must be silent
// and total: a themed office with four missing rooms is worse than an
// unthemed one. Every miss lands on the default art that already shipped.

import type { RoomId } from '../rooms'

export type ThemeId = 'default' | 'sect'

/**
 * Rooms with sect art, as filenames under `public/rooms/sect/`.
 *
 * This list is the directory, written down. check-docs.py fails the build if
 * it stops matching what is actually on disk, so it cannot rot into a lie
 * the way an unchecked list would.
 */
export const SECT_PLATES: readonly RoomId[] = [
  'ceo-office', 'kitchen', 'lobby', 'mac-studio',
  'main-office', 'meeting-room', 'nap-room', 'server-room',
]

/**
 * Resolve the plate URL for a room.
 *
 * `defaultPlate` is whatever the existing room definition already points at,
 * passed in rather than looked up: this function decides *theme*, it does not
 * own the default art.
 */
export function platePath(
  room: RoomId,
  theme: ThemeId,
  defaultPlate: string,
): string {
  if (theme === 'sect' && SECT_PLATES.includes(room)) {
    return `/rooms/sect/${room}.webp`
  }
  return defaultPlate
}

/** True when switching to `theme` would actually change this room's art. */
export function hasThemedArt(room: RoomId, theme: ThemeId): boolean {
  return theme === 'sect' && SECT_PLATES.includes(room)
}
