/**
 * SectRail — rail kanan proto: 氣陣 (ring qi), 名冊 (roster), 功過簿 (buku jasa).
 *
 * Bahasa Indonesia; hanzi sebagai ornamen. Data dipasang dari props,
 * bukan diambil sendiri, supaya tetap murni dan bisa diuji.
 */
import React from 'react'
import type { SectCast } from '../theme/sectCast'
import { rosterOf, sectSpritePath } from '../theme/sectCast'
import { SECT_HALLS } from '../theme/sect'

export interface LedgerRow {
  id: string
  label: string
  cost: string
  qi: number
}

export interface SectRailProps {
  /** Pembakaran jam ini, 0..4. */
  qi: number
  /** Batas atas per jam, rupiah/dolar (tampilan). */
  capLabel: string
  /** Kast lengkap untuk roster. */
  cast: readonly SectCast[]
  /** Baris buku jasa (12 terakhir). */
  ledger: readonly LedgerRow[]
  /** Klik baris roster → lompat ke aula. */
  onPickHall?: (hall: string) => void
}

export default function SectRail({
  qi, capLabel, cast, ledger, onPickHall,
}: SectRailProps) {
  const roster = rosterOf(cast)
  const qiText = ['', '聚氣', '氣盛', '氣逆', '走火入魔']
  const qiTextId = ['tenang', 'berkumpul', 'meluap', 'berbalik', 'menyimpang']

  return (
    <aside className="sect-rail" data-testid="sect-rail">
      {/* 氣陣 — ring pembakaran */}
      <section className="sect-slip sect-qi-scope" style={{ ['--qi' as string]: String(qi) }}>
        <h3><b className="han">氣陣</b><span>formasi qi</span></h3>
        <div className="sect-array">
          <div className="sect-ring">
            <span className="sect-ring__halo" aria-hidden="true" />
            <span className="sect-ring__disc" aria-hidden="true" />
            <span className="sect-ring__glyphs" aria-hidden="true" />
            <span className="sect-ring__read">
              <b>{(qi / 4).toFixed(2)}</b>
              <small>BURN</small>
            </span>
          </div>
          <div className="sect-array__meta">
            <div className="sect-array__state han">
              {qiText[Math.round(qi)]} {qiTextId[Math.round(qi)]}
            </div>
            <div className="sect-array__sub">
              batas per jam {capLabel} · lima tingkat dari 調息 sampai 走火入魔
            </div>
          </div>
        </div>
      </section>

      {/* 名冊 — roster */}
      <section className="sect-slip">
        <h3><b className="han">名冊</b><span>roster · {roster.length}</span></h3>
        <ul className="sect-roster">
          {roster.map((m) => {
            const hall = SECT_HALLS[m.hall]
            return (
              <li
                key={m.agentId}
                className="sect-rrow"
                style={{
                  ['--qi' as string]: String(m.qi),
                  ['--sprite' as string]: `url(${sectSpritePath(m.sprite)})`,
                  ['--ar' as string]: String(m.ar),
                }}
                tabIndex={0}
                role="button"
                onClick={() => onPickHall?.(m.hall)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPickHall?.(m.hall)
                  }
                }}
              >
                <span className="sect-rrow__art" aria-hidden="true" />
                <span className="sect-rrow__name">
                  <b className="han">{m.name}</b>
                  <small>{m.role}</small>
                </span>
                <span className="sect-rrow__hall">{hall?.cn ?? m.hall}</span>
                <span className="sect-rrow__qi" aria-hidden="true" />
              </li>
            )
          })}
        </ul>
      </section>

      {/* 功過簿 — buku jasa, scroll-driven */}
      <section className="sect-slip">
        <h3><b className="han">功過簿</b><span>buku jasa · terskrol</span></h3>
        <div className="sect-ltrack"><div className="sect-lfill" /></div>
        <div className="sect-lscroll">
          {ledger.map((row) => (
            <div
              key={row.id}
              className="sect-lrow"
              style={{ ['--qi' as string]: String(row.qi) }}
            >
              <code>{row.id}</code>
              <b>{row.label}</b>
              <span>{row.cost}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}
