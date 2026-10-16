/**
 * Warrant — the owner's way in.
 *
 * The office had no login: `GET /` minted a guest cookie, so every browser
 * became a guest and stayed one forever. Everything gated on `requireOwner`
 * — the ledger, the dossier, the replay, the Pos Jaga action buttons — was
 * unreachable from a browser by construction, and the product's whole owner
 * surface existed only for `curl`.
 *
 * With guest mode removed this is no longer one door among several. It is
 * THE door: signed out, the office serves its shell and nothing else.
 *
 * Three rules this component follows, all of them inherited from how the rest
 * of the UI treats the server's answers:
 *
 *   - The token is never stored. It is read from the field, sent once, and
 *     dropped. The server replies with an HttpOnly cookie, which is the only
 *     thing that persists — putting the bearer token in localStorage would
 *     hand every XSS a permanent key to the fleet.
 *   - A refusal is reported as the server worded it. 401 means the token was
 *     wrong; 429 means the session table is full, which is a different
 *     problem with a different fix, and collapsing them into "login failed"
 *     would send the operator hunting for the wrong thing.
 *   - It renders nothing for a viewer who already has standing. An owner does
 *     not need a door they are already through.
 */
import React, { useState } from 'react'

interface Props {
  /** True when the viewer holds no session — the only case with a door to open. */
  signedOut: boolean
  /** Injected in tests; defaults to the global. */
  fetchImpl?: typeof fetch
  /** Injected in tests so the success path does not reload the runner. */
  onEntered?: () => void
}

type State =
  | { kind: 'shut' }
  | { kind: 'open' }
  | { kind: 'sending' }
  | { kind: 'refused'; why: string }

/**
 * The server's own words, not ours.
 *
 * `POST /auth/session` answers 401 with `{error}` in Indonesian already. Where
 * it does not, the status is named rather than smoothed over: an operator who
 * sees "429" can look it up, while "gagal masuk" tells them nothing.
 */
async function refusalFor(res: Response): Promise<string> {
  let served: string | undefined
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error) served = body.error
  } catch {
    /* a proxy in front of the server can answer HTML; fall through to status */
  }
  if (served) return served
  if (res.status === 401) return 'Token ditolak'
  if (res.status === 429) return 'Terlalu banyak sesi aktif di server'
  return `Server menjawab ${res.status}`
}

export const Warrant: React.FC<Props> = ({ signedOut, fetchImpl, onEntered }) => {
  const [state, setState] = useState<State>({ kind: 'shut' })
  const [token, setToken] = useState('')

  // An owner is already through the door.
  if (!signedOut) return null

  const doFetch = fetchImpl ?? fetch

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const bearer = token.trim()
    if (!bearer || state.kind === 'sending') return
    setState({ kind: 'sending' })
    try {
      const res = await doFetch('/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${bearer}` },
      })
      if (!res.ok) {
        setState({ kind: 'refused', why: await refusalFor(res) })
        return
      }
      // Drop the token the moment it is spent. The cookie carries the session
      // from here and this component should not be holding a bearer secret in
      // React state a second longer than the request needs it.
      setToken('')
      // Nothing on the page was fetched with standing — no ladder, no
      // ledger, no action buttons. A reload is the honest way to re-ask every
      // one of those questions as the owner, rather than hand-patching state
      // and hoping nothing stayed stale.
      if (onEntered) onEntered()
      else window.location.reload()
    } catch {
      // Network-level failure. Distinct from a refusal: the server never
      // answered, so saying the token was rejected would be inventing one.
      setState({ kind: 'refused', why: 'Server tidak dapat dihubungi' })
    }
  }

  if (state.kind === 'shut') {
    return (
      <button
        type="button"
        className="sect-chain__chip"
        onClick={() => setState({ kind: 'open' })}
        title="Masuk sebagai pemilik dengan token"
      >
        Tamu · masuk
      </button>
    )
  }

  return (
    <div className="sect-warrant">
      <button
        type="button"
        className="sect-chain__chip"
        aria-expanded="true"
        onClick={() => setState({ kind: 'shut' })}
      >
        Tamu · masuk
      </button>
      <form className="sect-warrant__panel" onSubmit={submit}>
        <label className="sect-warrant__label" htmlFor="sect-warrant-token">
          Token pemilik
        </label>
        <input
          id="sect-warrant-token"
          className="sect-warrant__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          placeholder="OFFICE_OWNER_TOKEN"
          onChange={(e) => setToken(e.target.value)}
          disabled={state.kind === 'sending'}
        />
        <div className="sect-warrant__actions">
          <span className="sect-warrant__note">
            Dikirim sekali, tidak disimpan. Server membalas dengan cookie.
          </span>
          <button
            type="submit"
            className="sect-pill"
            disabled={state.kind === 'sending' || !token.trim()}
          >
            {state.kind === 'sending' ? 'Memeriksa…' : 'Masuk'}
          </button>
        </div>
        {state.kind === 'refused' && (
          <p className="sect-warrant__refused" role="alert">
            {state.why}
          </p>
        )}
      </form>
    </div>
  )
}

export default Warrant
