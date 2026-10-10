import { useEffect, useState } from 'react'

/**
 * Chain-integrity indicator + dossier export.
 *
 * Owner-only in practice: every endpoint behind it returns 403 to guests and
 * bridges, so the component simply renders nothing when the first probe is
 * refused. That is deliberate — showing a disabled "Export" control to a guest
 * would advertise the existence of an audit log they cannot read, and the
 * Fase 3 review flagged exactly this pattern (buttons guaranteed to 403) as a
 * defect worth fixing rather than repeating.
 *
 * The head hash is shown in full on hover, not truncated away, because the
 * entire point of publishing it is that an operator can copy it somewhere the
 * server does not control. Truncation here would quietly remove the only
 * defence against tail truncation in the ledger.
 */
type Head = { seq: number; hash: string; records: number }
type Verify = { ok: boolean; checked?: number; reason?: string; brokenAt?: number; tookMs?: number }

export const AuditBadge: React.FC<{ pollMs?: number }> = ({ pollMs = 30000 }) => {
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
        if (r.status === 403 || r.status === 401) { if (alive) setVisible(false); return }
        if (r.status === 503) { if (alive) { setHead(null); setVerify({ ok: false, reason: 'unavailable' }) } }
        else if (r.ok && alive) setHead(await r.json())
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

  const broken = verify && !verify.ok
  const state = broken ? 'broken' : verify?.ok ? 'verified' : 'unknown'

  return (
    <div className={`audit-badge audit-${state}`}>
      <button
        className="audit-chip"
        onClick={() => setOpen((v) => !v)}
        title={head ? `Kepala rantai: ${head.hash}` : 'Catatan audit'}
      >
        <span className="audit-dot" aria-hidden />
        <span className="audit-label">
          {broken ? 'RANTAI PUTUS' : `AUDIT · ${head?.records ?? '—'}`}
        </span>
      </button>

      {open && (
        <div className="audit-panel">
          <div className="audit-row">
            <span>Catatan</span>
            <strong>{head?.records ?? '—'}</strong>
          </div>
          <div className="audit-row">
            <span>Kepala</span>
            {/* Selectable, full-length: this value is meant to be copied out. */}
            <code className="audit-hash" title={head?.hash}>{head?.hash ?? '—'}</code>
          </div>

          {verify && (
            <div className={`audit-verdict ${verify.ok ? 'ok' : 'bad'}`}>
              {verify.ok
                ? `Terverifikasi ${verify.checked} catatan dalam ${verify.tookMs ?? 0} ms`
                : `GAGAL: ${verify.reason}${verify.brokenAt ? ` di #${verify.brokenAt}` : ''}`}
            </div>
          )}

          <div className="audit-actions">
            <button onClick={runVerify} disabled={busy}>
              {busy ? 'Memverifikasi…' : 'Verifikasi rantai'}
            </button>
            {/* A plain link, not fetch+blob: the server already sets
                Content-Disposition, and letting the browser handle the
                download keeps the export working if JS state is stale. */}
            <a className="audit-export" href="/dossier" download>
              Ekspor dossier
            </a>
          </div>

          <p className="audit-note">
            Tahan-rusak, bukan anti-rusak. Salin hash kepala ke tempat yang
            tidak bisa dijangkau server ini supaya pemangkasan ekor bisa dideteksi.
          </p>
        </div>
      )}
    </div>
  )
}

export default AuditBadge
