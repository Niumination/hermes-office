/**
 * Segel — the seal.
 *
 * Chain integrity, rendered as the sect's seal on its own records. This is
 * the replacement for the old `AuditBadge`, which the sect rebuild dropped:
 * the new UI shipped without any ledger surface at all for several patches,
 * which quietly removed the product's central claim — replay is governance —
 * from the only place a buyer actually looks.
 *
 * Two behaviours are inherited deliberately from the old badge:
 *
 *   - It renders NOTHING once a probe is refused. Showing a guest a disabled
 *     "verify" control would advertise an audit log they cannot read.
 *   - The head hash is shown in full and selectable. Truncating it would
 *     remove the only defence against tail truncation: an operator copying
 *     the hash somewhere this server does not control.
 *
 * One behaviour is deliberately NOT inherited. The old badge reported
 * `verify.ok`, which is chain-link integrity alone. The server also computes
 * `trustworthy = chain ok AND anchors ok`, and those can disagree: a chain
 * can be internally consistent and still contradict its external anchors,
 * which is exactly the case where a seal saying "terverifikasi" is a lie.
 * This component reports the weaker of the two and names which one failed.
 */
import React, { useEffect, useState } from 'react'

interface Head { seq: number; hash: string; records: number }

interface Anchors { ok: boolean; strength: string; anchors: number }

interface Verify {
  ok: boolean
  trustworthy?: boolean
  anchors?: Anchors
  checked?: number
  reason?: string
  brokenAt?: number
  tookMs?: number
}

export const Seal: React.FC<{ pollMs?: number }> = ({ pollMs = 30000 }) => {
  const [head, setHead] = useState<Head | null>(null)
  const [verify, setVerify] = useState<Verify | null>(null)
  const [visible, setVisible] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const r = await fetch('/ledger/head', { credentials: 'include' })
        if (r.status === 401 || r.status === 403) { if (alive) setVisible(false); return }
        if (r.status === 503) {
          // The ledger is off, which is not the same as broken. Say which.
          if (alive) { setHead(null); setVerify({ ok: false, reason: 'ledger tidak aktif' }) }
        } else if (r.ok && alive) {
          setHead(await r.json())
        }
      } catch {
        /* transient; keep the last known value rather than flashing an alarm */
      }
      if (alive) timer = setTimeout(tick, pollMs)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [pollMs, visible])

  if (!visible) return null

  const runVerify = async () => {
    setBusy(true)
    try {
      const r = await fetch('/ledger/verify', { credentials: 'include' })
      setVerify(r.ok ? await r.json() : { ok: false, reason: `http ${r.status}` })
    } catch (e) {
      setVerify({ ok: false, reason: String(e) })
    } finally {
      setBusy(false)
    }
  }

  // One verdict, one source. An earlier cut computed the indicator dot from
  // `trustworthy` but the sentence beneath it from `ok` and the anchor flags
  // separately. A mutation test caught the consequence: with the dot wired to
  // `ok`, the seal glowed green while the sentence under it said the anchors
  // disagreed. Two expressions for one claim is how a UI ends up contradicting
  // itself in the exact situation the claim exists for.
  //
  // `trustworthy` is the honest headline when the server sends it; fall back
  // to `ok` only for a server too old to compute it.
  const chainBroken = verify ? !verify.ok : false
  const anchorsBroken = Boolean(verify && verify.ok && verify.anchors && !verify.anchors.ok)
  const trusted = verify
    ? (verify.trustworthy ?? (!chainBroken && !anchorsBroken))
    : null
  const state = trusted === null ? 'unknown' : trusted ? 'sealed' : 'broken'

  return (
    <div className={`sect-chain sect-chain--${state}`}>
      <button
        type="button"
        className="sect-chain__chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={head ? `Kepala rantai: ${head.hash}` : 'Catatan audit'}
      >
        <span className="sect-chain__dot" aria-hidden="true" />
        <span className="sect-script">Segel</span>
        <span className="sect-chain__label">
          {chainBroken ? 'RANTAI PUTUS'
            : anchorsBroken ? 'JANGKAR BEDA'
            : `${head?.records ?? '—'} catatan`}
        </span>
      </button>

      {open && (
        <div className="sect-chain__panel">
          <div className="sect-chain__row">
            <span>Catatan</span><strong>{head?.records ?? '—'}</strong>
          </div>
          <div className="sect-chain__row">
            <span>Kepala</span>
            {/* Selectable, full length: this value exists to be copied out. */}
            <code className="sect-chain__hash" title={head?.hash}>{head?.hash ?? '—'}</code>
          </div>

          {verify && (
            <div className={`sect-chain__verdict ${trusted ? 'ok' : 'bad'}`}>
              {chainBroken
                ? `GAGAL: ${verify.reason ?? 'rantai tidak sah'}${verify.brokenAt ? ` di #${verify.brokenAt}` : ''}`
                : anchorsBroken
                  ? `Rantai utuh (${verify.checked} catatan), tetapi ${verify.anchors?.anchors ?? 0} jangkar tidak sepakat — jangan anggap tersegel`
                  : `Tersegel: ${verify.checked} catatan dalam ${verify.tookMs ?? 0} ms`}
            </div>
          )}

          {verify?.anchors && (
            <div className="sect-chain__row">
              <span>Jangkar</span>
              <strong>{verify.anchors.strength} · {verify.anchors.anchors}</strong>
            </div>
          )}

          <div className="sect-chain__actions">
            <button type="button" onClick={runVerify} disabled={busy}>
              {busy ? 'Memverifikasi…' : 'Verifikasi rantai'}
            </button>
            {/* A plain link, not fetch+blob: the server already sets
                Content-Disposition, and letting the browser do the download
                keeps the export working when JS state is stale. */}
            <a className="sect-chain__export" href="/dossier" download>Ekspor dossier</a>
          </div>

          <p className="sect-chain__note">
            Tahan-rusak, bukan anti-rusak. Salin hash kepala ke tempat yang
            tidak bisa dijangkau server ini supaya pemangkasan ekor bisa dideteksi.
          </p>
        </div>
      )}
    </div>
  )
}

export default Seal
