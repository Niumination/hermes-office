/**
 * SectStage — panggung aula sektoral, port proto/office-sect.html.
 *
 * Bukan pengganti OfficeStage; ini kulit sektalar. Satu aula (plate
 * /rooms/sect/), agen sebagai tombol sprite, kabut 雲深不知處 untuk aula
 * di atas tingkat penonton. Semua teks bahasa Indonesia.
 */
import React from 'react'
import type { RoomId } from '../rooms'
import { SECT_CAST, castInHall, qiLabelId, sectSpritePath } from '../theme/sectCast'
import { SECT_HALLS } from '../theme/sect'
import { platePath } from '../theme/plates'
import { useTheme } from '../theme/themeStore'

export interface SectStageProps {
  /** Aula yang sedang ditampilkan. */
  hall: RoomId
  /** Aula ini terkunci (di atas tingkat penonton)? */
  locked: boolean
  /** Daftar id agen yang online; yang lain diredupkan. */
  onlineIds?: ReadonlySet<string>
  /** Klik agen → buka dossier samping. */
  onAgentClick?: (agentId: string) => void
}

export default function SectStage({
  hall, locked, onlineIds, onAgentClick,
}: SectStageProps) {
  const theme = useTheme()
  const meta = SECT_HALLS[hall]
  const cast = castInHall(SECT_CAST, hall)

  const plate = platePath(hall, theme, '/rooms/office-day.webp')

  return (
    <section
      className="sect-stage"
      data-testid="sect-stage"
      data-locked={locked ? '' : undefined}
      aria-label={`Aula ${meta?.cn ?? hall}`}
    >
      <div
        className="sect-hall__plate"
        style={{ backgroundImage: `url(${plate})` }}
      />
      <div className="sect-hall__grade" aria-hidden="true" />
      <div className="sect-hall__ink" aria-hidden="true" />
      <div className="sect-hall__vig" aria-hidden="true" />
      <div className="sect-hall__clouds" aria-hidden="true"><i /><i /></div>

      {/* 雲深不知處 — aula di atas realm penonton tidak dibuka */}
      {locked && (
        <div className="sect-hall__fog" aria-hidden="true">
          <span>雲深不知處<small>di luar jangkauanmu</small></span>
        </div>
      )}

      {cast.map((member) => {
        const online = onlineIds?.has(member.agentId) ?? true
        const label = qiLabelId(member.qi)
        return (
          <button
            key={member.agentId}
            type="button"
            className="sect-agent"
            data-testid={`sect-agent-${member.agentId}`}
            data-online={online ? undefined : ''}
            style={{
              ['--x' as string]: `${member.x}%`,
              ['--y' as string]: `${member.y}%`,
              ['--sc' as string]: String(member.sc),
              ['--qi' as string]: String(member.qi),
              ['--sprite' as string]: `url(${sectSpritePath(member.sprite)})`,
              ['--ar' as string]: String(member.ar),
            }}
            aria-label={`${member.name}, ${member.role}, qi ${label.id}`}
            onClick={() => onAgentClick?.(member.agentId)}
          >
            <span className="sect-agent__aura" aria-hidden="true" />
            <span className="sect-agent__art" />
            <span className="sect-agent__tag">
              <b className="han">{member.name}</b>
              {member.role}
            </span>
          </button>
        )
      })}

      {meta && (
        <div className="sect-hall__seal">
          <b className="han">{meta.cn}</b>
          <span>{meta.en} · {meta.band}</span>
        </div>
      )}
    </section>
  )
}
