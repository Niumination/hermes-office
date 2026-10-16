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
 *   - It renders NOTHING once a probe is refused. Showing a viewer a disabled
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

/** GET /proof — see server/proof.js. One shape, owner-only; the
 *  fields this component reads are present in both, except `served` /
 *  `verifiedBundle`, which only an owner is allowed to see. */
interface Proof {
  reportMissing: boolean
  bundleMatches: boolean | null
  verification: { verifiedAt?: string; gatesGreen?: number; gatesTotal?: number } | null
  served?: { file: string } | null
  verifiedBundle?: string | null
}

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
  const [proof, setProof] = useState<Proof | null>(null)

  // Build evidence is fetched once, in its own effect. It changes when the
  // server is redeployed, not on a polling cadence — and sharing the head
  // poll's tick would reorder that poll's requests, which is exactly what
  // broke its "keep the last known value" test the first time.
  useEffect(() => {
    let alive = true
    void fetch('/proof', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setProof(d as Proof) })
      .catch(() => { /* additive: its absence must never blank the seal */ })
    return () => { alive = false }
  }, [])

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

          {/* Bukti build. Separate from the chain on purpose: the chain says
              "this record was not edited", this says "the thing you are
              looking at is the thing we tested". A seal that conflates them
              certifies a different building. */}
          {proof && (
            <div className="sect-chain__proof">
              {proof.reportMissing ? (
                <div className="sect-chain__row">
                  <span>Gerbang</span>
                  {/* Never "0/0": nobody ran the suite and the suite failed
                      are different facts. */}
                  <strong>belum pernah dicatat</strong>
                </div>
              ) : (
                <>
                  <div className="sect-chain__row">
                    <span>Gerbang</span>
                    <strong>
                      {proof.verification?.gatesGreen}/{proof.verification?.gatesTotal} hijau
                    </strong>
                  </div>
                  <div className="sect-chain__row">
                    <span>Diverifikasi</span>
                    {/* The timestamp is not decoration: it is the only way a
                        reader can judge staleness without trusting us. */}
                    <strong>{proof.verification?.verifiedAt?.replace('T', ' ').replace('Z', ' UTC') ?? '—'}</strong>
                  </div>
                </>
              )}

              {proof.bundleMatches === false && (
                <div className="sect-chain__verdict bad">
                  Yang disajikan BUKAN yang diuji: server menyajikan{' '}
                  <code>{proof.served?.file ?? '—'}</code> sementara gerbang di
                  atas dijalankan terhadap <code>{proof.verifiedBundle ?? '—'}</code>.
                  Perlakukan hasil gerbang itu sebagai milik build lain.
                </div>
              )}
              {proof.bundleMatches === null && !proof.reportMissing && (
                <div className="sect-chain__row">
                  <span>Build</span>
                  {/* unknown is not a mismatch — same rule as the desks board. */}
                  <strong>tidak bisa dicocokkan</strong>
                </div>
              )}
            </div>
          )}

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
