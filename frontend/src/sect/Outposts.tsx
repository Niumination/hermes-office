/**
 * Pos Jaga — the fourth panel of the right-hand scroll.
 *
 * Babad is what the fleet did, Murid is who is present, Sabda is what was
 * said, Pos Jaga is what the sect watches from a distance: cron jobs and
 * sibling services the office does not run and cannot command.
 *
 * Four states, four different truths, and the fourth one is the important
 * one. `unknown` is rendered as its own thing — not a red light. An outpost
 * we failed to reach has not failed; we failed to ask. Painting that red
 * trains an operator to ignore red, and then the real failure goes unseen.
 *
 * There are no buttons here. Phase one of the outpost plan is observation
 * only, so there is nothing in this component that can change anything —
 * which is why a guest can safely be shown the same panel, minus the
 * internal hostnames the server already redacts.
 */
import React from 'react'
import type { Outpost, OutpostState } from './useOutposts'
import { SECT_HALLS } from '../theme/sect'

/**
 * A desk's `hall` is a free-form string from an owner-written JSON file, not
 * a RoomId the compiler can vouch for. Looking it up through a widened view
 * keeps an unknown hall from being a type error here and a crash there: an
 * unrecognised name simply renders no hall, which is the honest outcome.
 */
const HALL_BY_ID = SECT_HALLS as Record<string, { nameId: string } | undefined>

/** Sect names for the four states. */
const STATE_LABEL: Record<OutpostState, string> = {
  ok: 'Aman',
  failed: 'Genting',
  stale: 'Senyap',
  unknown: 'Tak Terjangkau',
}

/** Longer gloss, shown as a title so the metaphor never hides the meaning. */
const STATE_GLOSS: Record<OutpostState, string> = {
  ok: 'Pos menjawab dan sehat',
  failed: 'Pos menjawab, tetapi tidak sebagaimana mestinya',
  stale: 'Pos sehat terakhir kali, tetapi sudah terlalu lama diam',
  unknown: 'Kami tidak berhasil bertanya — bukan berarti ia rusak',
}

function clock(ts: number | null): string {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(ts))
  } catch { return '—' }
}

export interface OutpostsProps {
  outposts: Outpost[]
  problems: string[]
  loaded: boolean
  stale: boolean
  lastOkTs: number | null
}

export default function Outposts(props: OutpostsProps) {
  const { outposts, problems, loaded, stale, lastOkTs } = props

  return (
    <div className="sect-log sect-posts" data-testid="outposts-panel">
      {stale && (
        <p className="sect-posts__stale" role="status" data-testid="outposts-stale">
          Kabar terakhir {clock(lastOkTs)} — perguruan belum terhubung kembali.
        </p>
      )}

      {loaded && outposts.length === 0 && (
        <p className="sect-log__empty">
          Belum ada pos jaga. Tunjuk <code>OFFICE_DESKS_FILE</code> ke berkas
          seperti <code>desks.example.json</code>.
        </p>
      )}

      {outposts.map((o) => {
        const hall = o.hall ? HALL_BY_ID[o.hall] : undefined
        return (
          <article
            key={o.id}
            className={`sect-post is-${o.state}`}
            data-testid="outpost"
            data-state={o.state}
          >
            <span className="sect-post__lamp" aria-hidden="true" />
            <div className="sect-post__body">
              <header className="sect-post__head">
                <span className="sect-post__name">{o.label}</span>
                <span className="sect-post__state" title={STATE_GLOSS[o.state]}>
                  {STATE_LABEL[o.state]}
                </span>
              </header>

              <p className="sect-post__meta">
                {hall && <span className="sect-post__hall">{hall.nameId}</span>}
                {hall && ' · '}
                <span className="sect-post__kind">{o.kind === 'file' ? 'berkas' : 'http'}</span>
                {o.lastTs != null && <> · terakhir {clock(o.lastTs)}</>}
                {o.checkedTs != null && <> · diperiksa {clock(o.checkedTs)}</>}
              </p>

              {o.note && <p className="sect-post__note">{o.note}</p>}

              {/* Shown verbatim when the server sends it; a guest gets null
                  because the detail is where internal hosts leak. */}
              {o.detail && <p className="sect-post__detail">{o.detail}</p>}
            </div>
          </article>
        )
      })}

      {problems.length > 0 && (
        <div className="sect-posts__problems" data-testid="outposts-problems">
          <p className="sect-posts__problems-h">Berkas pos jaga bermasalah:</p>
          <ul>
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
