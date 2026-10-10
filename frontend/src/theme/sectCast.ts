// Peta kekuatan sect — siapa di aula mana, dan qi-nya.
//
// Bukan model ruangan kedua. Room id tetap 'server-room' bukan 'zhenfa'
// (kontrak API tidak tersentuh). Ini hanya lapisan nama + posisi pertunjukan
// untuk tata letak sektoral, diambil dari proto/office-sect.html.
//
// Posisi memakai sistem proto: persen relatif terhadap aula, --x/--y/--sc.

import type { RoomId } from '../rooms'
import type { AtmosphereState } from '../components/AtmosphereLayer'

/** Identitas pertunjukan satu agen di dalam aula. */
export interface SectCast {
  agentId: string
  name: string
  role: string
  hall: RoomId
  x: number
  y: number
  sc: number
  sprite: string
  ar: number
  qi: number
}

// ═════════════════════════════════════════════════════════════════════
//  KAST SECT — 8 karakter proto/office-sect.html, diterjemahkan
// ═════════════════════════════════════════════════════════════════════
//
//    雲昭 manager   → boss        (掌門殿 / ceo-office)
//    鐵牧 devops    → cloud       (陣法室 / server-room)
//    石嵐 security  → octo        (陣法室 / server-room)
//    素晴 frontend  → mac         (修煉場 / main-office)
//    林遠 fullstack → cron-runner (修煉場 / main-office)
//    白洛 tester    → tester      (修煉場 / main-office)
//    文吉 reviewer  → reviewer    (山門 / lobby)
//    沈和 debugger  → debugger    (山門 / lobby)

export const SECT_CAST: readonly SectCast[] = [
  { agentId: 'boss', name: 'Awan Surya', role: 'manajer', hall: 'ceo-office',
    x: 50, y: 72, sc: 1.0, sprite: 'elder', ar: 0.515, qi: 1 },

  { agentId: 'cloud', name: 'Baja Menggembala', role: 'devops', hall: 'server-room',
    x: 38, y: 74, sc: 0.96, sprite: 'forge', ar: 0.66, qi: 2 },
  { agentId: 'octo', name: 'Batu Badai', role: 'keamanan', hall: 'server-room',
    x: 62, y: 77, sc: 0.96, sprite: 'guardian', ar: 0.555, qi: 3 },

  { agentId: 'mac', name: 'Senja Cerah', role: 'frontend', hall: 'main-office',
    x: 33, y: 70, sc: 0.9, sprite: 'weaver', ar: 0.775, qi: 0 },
  { agentId: 'cron-runner', name: 'Hutan Jauh', role: 'fullstack', hall: 'main-office',
    x: 52, y: 76, sc: 0.94, sprite: 'cultivator', ar: 0.59, qi: 2 },
  { agentId: 'tester', name: 'Putih Jatuh', role: 'penguji', hall: 'main-office',
    x: 70, y: 72, sc: 0.9, sprite: 'alchemist', ar: 0.66, qi: 4 },

  { agentId: 'reviewer', name: 'Budiman', role: 'peninjau', hall: 'lobby',
    x: 36, y: 76, sc: 0.88, sprite: 'scholar', ar: 0.625, qi: 1 },
  { agentId: 'debugger', name: 'Tentram', role: 'pengawakutuan', hall: 'lobby',
    x: 64, y: 74, sc: 0.88, sprite: 'physician', ar: 0.59, qi: 0 },
]

/** Urutan aula dari puncak ke kaki, untuk tangga dan roster. */
export const HALL_ORDER: readonly RoomId[] = [
  'ceo-office', 'server-room', 'main-office', 'lobby',
]

/** Kast yang berdiri di satu aula. */
export function castInHall(cast: readonly SectCast[], hall: RoomId): readonly SectCast[] {
  return cast.filter(c => c.hall === hall)
}

/** Kast, diurutkan dari puncak gunung ke kaki (roster 名冊). */
export function rosterOf(cast: readonly SectCast[]): readonly SectCast[] {
  return [...cast].sort(
    (a, b) => HALL_ORDER.indexOf(a.hall) - HALL_ORDER.indexOf(b.hall),
  )
}

/** Qi 0..4 untuk satu AtmosphereState. */
export function sectQi(state: AtmosphereState): number {
  const map: Record<AtmosphereState, number> = {
    normal: 0, warm: 1, hot: 2, critical: 3, tripped: 4,
  }
  return map[state]
}

/** Label qi bahasa Indonesia + hanzi untuk satu tingkat 0..4. */
export function qiLabelId(qi: number): { cn: string; id: string } {
  const labels: { cn: string; id: string }[] = [
    { cn: '調息', id: 'tenang' },
    { cn: '聚氣', id: 'berkumpul' },
    { cn: '氣盛', id: 'meluap' },
    { cn: '氣逆', id: 'berbalik' },
    { cn: '走火入魔', id: 'menyimpang' },
  ]
  return labels[Math.max(0, Math.min(4, Math.round(qi)))]
}

/** Path sprite donghua depan-kiri untuk satu nama sprite. */
export function sectSpritePath(sprite: string): string {
  return `/sprites/donghua/${sprite}-front-left.webp`
}
