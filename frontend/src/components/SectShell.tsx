/**
 * SectShell — kerangka prototipe office-sect.html: header (stempel 宗 +
 * toggle penonton) + tangga aula + panggung + rail kanan.
 *
 * Inilah pengganti tampilan HermesOfficeApp lama. Semua teks bahasa
 * Indonesia; hanzi (宗門, 山門, 修煉場, ...) tetap sebagai ornamen kelas
 * .han persis seperti proto.
 *
 * Berbeda dari proto: tangga dan aula diturunkan dari kebijakan ruangan
 * (sectLadder), bukan hardcode — supaya urutan dan harga tetap benar.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import SectStage from './SectStage'
import SectRail from './SectRail'
import type { RoomId } from '../rooms'
import { SECT_CAST } from '../theme/sectCast'
import { SECT_HALLS, sectLadder, canEnter } from '../theme/sect'
import type { SectRung } from '../theme/sect'
import { useTheme } from '../theme/themeStore'

/** Kebijakan ruangan minimal untuk membangun tangga. */
const POLICY_ROOMS: Record<string, { budgetHourlyUsd?: number }> = {
  lobby: { budgetHourlyUsd: 0.25 },
  'meeting-room': { budgetHourlyUsd: 1 },
  'main-office': { budgetHourlyUsd: 2 },
  'mac-studio': { budgetHourlyUsd: 3 },
  'server-room': { budgetHourlyUsd: 5 },
  'ceo-office': { budgetHourlyUsd: 10 },
  kitchen: { budgetHourlyUsd: 0 },
  'nap-room': { budgetHourlyUsd: 0 },
}

export interface SectShellProps {
  /** Mode mock? Tampilan status koneksi. */
  mock?: boolean
  /** Terhubung ke server? */
  connected?: boolean
  /** Guest (pemirsa hanya-baca)? */
  guest?: boolean
  /** Daftar id agen online. */
  onlineIds?: ReadonlySet<string>
}

export default function SectShell({
  mock, connected, guest, onlineIds,
}: SectShellProps) {
  const theme = useTheme()
  const rungs = useMemo(() => sectLadder(POLICY_ROOMS), [])
  const sectRungs = useMemo(
    () => rungs.filter(r => SECT_HALLS[r.room] !== undefined),
    [rungs],
  )

  // Aula aktif. Default: aula terendah yang boleh dimasuki.
  const viewerTier = guest ? -1 : 99
  const [hall, setHall] = useState<RoomId>(() => {
    const first = [...sectRungs].reverse().find(r => canEnter(r, viewerTier))
    return first ? first.room : 'lobby'
  })

  const go = useCallback((key: string) => {
    const target = sectRungs.find(r => r.room === key)
    if (!target || !canEnter(target, viewerTier)) return
    setHall(key as RoomId)
  }, [sectRungs, viewerTier])

  const current = sectRungs.find(r => r.room === hall)
  const locked = current ? !canEnter(current, viewerTier) : false
  const qi = current ? Math.min(4, current.tier) : 0

  return (
    <div className="sect-shell" data-testid="sect-shell">
      <header className="sect-bar sect-glass">
        <div className="sect-seal2 han">宗</div>
        <div className="sect-grow">
          <h1>
            <span className="han">宗門</span>
            Hermes Sect{' '}
            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
              — denah lantai adalah kebijakannya
            </span>
          </h1>
          <p>ketinggian = tingkat izin · aura = rasio pembakaran · kabut = 403</p>
        </div>
        <div className="sect-seg" role="group" aria-label="Penonton">
          <button
            type="button"
            aria-pressed={!guest}
            onClick={() => { /* beralih ke pemilik: urusannya HermesOfficeApp */ }}
            title="token pemilik"
          >
            掌門 pemilik
          </button>
          <button
            type="button"
            aria-pressed={guest}
            onClick={() => { /* beralih ke tamu */ }}
            title="token tamu — diterbitkan otomatis di gerbang"
          >
            客 tamu
          </button>
        </div>
      </header>

      <main>
        {/* Tangga: puncak dulu, turun ke kaki */}
        <nav className="sect-ladder2 sect-glass" aria-label="Aula berdasarkan ketinggian">
          {[...sectRungs].reverse().map(rung => {
            const open = canEnter(rung, viewerTier)
            const hallMeta = SECT_HALLS[rung.room]!
            return (
              <button
                key={rung.room}
                type="button"
                className="sect-rung"
                data-locked={open ? undefined : ''}
                aria-current={rung.room === hall ? 'true' : undefined}
                aria-disabled={open ? undefined : 'true'}
                onClick={() => go(rung.room)}
              >
                <span className="sect-rung__cap">
                  {rung.capUsd === 0 ? '—' : `$${rung.capUsd.toFixed(2)}`}
                </span>
                <span className="sect-rung__node" aria-hidden="true" />
                <span className="sect-rung__cn">{hallMeta.cn}</span>
                <span className="sect-rung__band">{hallMeta.band}</span>
                {!open && (
                  <span className="sect-rung__lock">
                    封<span className="sect-rung__sr"> — di luar jangkauanmu</span>
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <SectStage
          hall={hall}
          locked={locked}
          onlineIds={onlineIds}
          onAgentClick={() => { /* dossier samping: tahap berikutnya */ }}
        />

        <SectRail
          qi={qi}
          capLabel="$4.00"
          cast={SECT_CAST}
          ledger={SAMPLE_LEDGER}
          onPickHall={go}
        />
      </main>

      <footer className="sect-note">
        <b>Tanpa WebGL, tanpa canvas, tanpa R3F.</b> Setiap aula adalah DOM
        yang bisa ditanyakan oleh tes frontend; setiap plate lolos tujuh
        aturan plate milik repo ini sendiri. Kedalaman adalah CSS, seni
        tidak diubah, gerakan adalah compositor.
      </footer>
    </div>
  )
}

const SAMPLE_LEDGER = [
  { id: '#1040', label: 'tool_done · bash', cost: '$0.012', qi: 0 },
  { id: '#1041', label: 'persetujuan 符 diberikan · 陣法室', cost: '$0.000', qi: 2 },
  { id: '#1042', label: 'tool_done · deploy', cost: '$0.240', qi: 2 },
  { id: '#1043', label: 'anggaran 聚氣 berkumpul', cost: '$0.000', qi: 1 },
  { id: '#1044', label: 'tool_done · kubectl', cost: '$0.180', qi: 2 },
  { id: '#1045', label: 'rantai berlabuh', cost: '$0.000', qi: 0 },
  { id: '#1046', label: 'tool_done · test', cost: '$0.031', qi: 1 },
  { id: '#1047', label: 'anggaran 氣盛 meluap', cost: '$0.000', qi: 2 },
  { id: '#1048', label: 'tool_done · build', cost: '$0.096', qi: 1 },
  { id: '#1049', label: 'persetujuan 符 ditolak · 掌門殿', cost: '$0.000', qi: 3 },
]
