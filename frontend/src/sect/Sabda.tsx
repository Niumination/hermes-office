/**
 * Sabda — the spoken word.
 *
 * The third tab of the right-hand scroll: Babad is what the fleet *did*,
 * Murid is who is *present*, Sabda is what was *said*. Three different kinds
 * of truth, so three panels rather than one merged feed.
 *
 * Signed out there is no transcript and no composer, because `GET /chat`
 * `requireAuth(["bridge","owner"])` and would refuse them. The badge states
 * that plainly instead of leaving a dead input box on screen.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { SabdaMessage } from './useSabda'
import { toggleNiuMode } from '../hermes/niu'

/** Same set the old office offered, kept so muscle memory survives the port. */
export const REACTIONS = ['👍', '🔥', '🎉', '😂', '🚀'] as const

const mark = (who: string): string =>
  (who || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '??'

function clock(ts: number): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(new Date(ts))
  } catch { return '' }
}

export interface SabdaProps {
  messages: SabdaMessage[]
  typing: string | null
  refusal: string | null
  signedOut: boolean
  loaded: boolean
  onSend: (text: string) => void
  onReact: (id: number | string, emoji: string) => void
}

export default function Sabda(props: SabdaProps) {
  const { messages, typing, refusal, signedOut, loaded, onSend, onReact } = props
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState<number | string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Follow the tail only when the reader is already at the tail. Yanking the
  // view down while someone is reading older lines is a hostile scroll.
  // Same mechanism as Chronicle: assigning scrollTop, not scrollIntoView,
  // which jsdom does not implement and which would make this untestable.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atTail) el.scrollTop = el.scrollHeight
  }, [messages, typing])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    // Local commands never reach the server; they are view state.
    if (text === '/niu-mode' || text === '/niu') { toggleNiuMode(); setDraft(''); return }
    onSend(text)
    setDraft('')
  }

  const body = useMemo(() => messages.filter((m) => m.text !== ''), [messages])

  return (
    <div className="sect-sabda" data-testid="sabda-panel">
      <div className="sect-log sect-sabda__list" ref={listRef}>
        {loaded && body.length === 0 && (
          <p className="sect-log__empty">Belum ada sabda.</p>
        )}

        {body.map((m) => (
          <article
            key={String(m.id)}
            className={`sect-said${m.system ? ' is-system' : ''}${m.streaming ? ' is-streaming' : ''}`}
            data-testid="sabda-line"
          >
            <span className="sect-said__mark" aria-hidden="true">{mark(m.sender)}</span>
            <div className="sect-said__body">
              <header className="sect-said__head">
                <span className="sect-said__who">{m.sender}</span>
                <time className="sect-said__t">{clock(m.timestamp)}</time>
              </header>
              <p className="sect-said__text">{m.text}</p>

              {m.reactions.length > 0 && (
                <div className="sect-said__reacts">
                  {m.reactions.map((r, i) => (
                    <span className="sect-react" key={`${r}-${i}`}>{r}</span>
                  ))}
                </div>
              )}

              {!m.streaming && (
                <div className="sect-said__tools">
                  <button
                    type="button"
                    className="sect-said__more"
                    aria-label={`Beri tanggapan untuk sabda ${m.sender}`}
                    aria-expanded={open === m.id}
                    onClick={() => setOpen(open === m.id ? null : m.id)}
                  >☰</button>
                  {open === m.id && (
                    <div className="sect-said__picker" role="group" aria-label="Tanggapan">
                      {REACTIONS.map((emoji) => (
                        <button
                          type="button" key={emoji} className="sect-react sect-react--btn"
                          onClick={() => { onReact(m.id, emoji); setOpen(null) }}
                        >{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {typing && (
        <p className="sect-sabda__typing" aria-live="polite">
          {typing} sedang merangkai kata…
        </p>
      )}

      {refusal && (
        <p className="sect-sabda__refusal" role="status" data-testid="sabda-refusal">
          {refusal}
        </p>
      )}

      {signedOut ? (
        <p className="sect-sabda__guest" data-testid="sabda-guest">
          Perguruan sunyi bagi yang belum bersegel — tunjukkan segel untuk bersabda.
        </p>
      ) : (
        <form className="sect-sabda__composer" onSubmit={submit}>
          <input
            className="sect-sabda__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Sampaikan sabda…"
            aria-label="Sabda"
          />
          <button type="submit" className="sect-sabda__send" disabled={draft.trim() === ''}>
            Kirim
          </button>
        </form>
      )}
    </div>
  )
}
