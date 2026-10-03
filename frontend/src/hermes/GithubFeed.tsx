/**
 * GithubFeed — GitHub activity tab (UI-SPEC.md §6).
 * Renders `git_push` events as a feed; 🔒 badge for private repos.
 * Filter: All / Public only / Author.
 */
import React, { useMemo, useState } from 'react'
import type { GithubFeedItem, HermesEnvelope } from './types'

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function toItem(e: HermesEnvelope, i: number): GithubFeedItem {
  const g = e as any
  return {
    id: String(g.id ?? `${g.repo ?? 'repo'}-${e.ts ?? i}-${i}`),
    repo: String(g.repo ?? 'unknown'),
    privat: !!g.privat,
    author: String(g.author ?? 'unknown'),
    commits: Number(g.commits ?? 1),
    message: String(g.message ?? ''),
    url: g.url ? String(g.url) : undefined,
    ts: Number(e.ts ?? Date.now()),
  }
}

interface Props {
  events: HermesEnvelope[]
}

export const GithubFeed: React.FC<Props> = ({ events }) => {
  const [filter, setFilter] = useState<'all' | 'public'>('all')

  const items = useMemo(() => {
    const all = events
      .filter(e => e.type === 'git_push')
      .map(toItem)
      .sort((a, b) => b.ts - a.ts)
    // Guest/normal: the server already filters private pushes for guests,
    // but respect "Public only" filter client-side too.
    return filter === 'public' ? all.filter(i => !i.privat) : all
  }, [events, filter])

  const authors = useMemo(() => [...new Set(items.map(i => i.author))], [items])
  const [author, setAuthor] = useState<string>('')

  const shown = author ? items.filter(i => i.author === author) : items

  return (
    <div className="github-feed" data-testid="github-feed">
      <div className="github-controls">
        <select
          className="github-filter"
          value={filter}
          onChange={e => setFilter(e.target.value as 'all' | 'public')}
        >
          <option value="all">All repos</option>
          <option value="public">Public only</option>
        </select>
        <select
          className="github-filter"
          value={author}
          onChange={e => setAuthor(e.target.value)}
        >
          <option value="">All authors</option>
          {authors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className="github-list">
        {shown.length === 0 && <div className="github-empty">No pushes yet</div>}
        {shown.map(item => (
          <div key={item.id} className="github-item">
            <div className="github-item-head">
              <span className="github-repo">🔄 {item.repo}</span>
              {item.privat && <span className="github-lock" title="private repo">🔒</span>}
              <span className="github-time">{relTime(item.ts)}</span>
            </div>
            <div className="github-msg">
              <span className="github-author">{item.author}</span>
              {' — '}
              {item.commits} commit{item.commits === 1 ? '' : 's'}
              {item.message && <> — “{item.message}”</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default GithubFeed
