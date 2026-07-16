import { useEffect, useState } from 'react'
import { Film, Globe2, Play, Search, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getBrowseFeed } from '../api/client'
import type { StreamItem } from '../api/types'
import { VideoGrid } from '../components/VideoGrid'
import { OpenLinkBar } from '../components/OpenLinkBar'
import { getRegion } from '../store/settings'

type FeedMode = 'trending' | 'videos' | 'music'

const TABS: { id: FeedMode; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'videos', label: 'Videos' },
  { id: 'music', label: 'Music' },
]

const SKELETON_CARDS = Array.from({ length: 6 }, (_, index) => index)

export function HomePage() {
  const [mode, setMode] = useState<FeedMode>('trending')
  const [items, setItems] = useState<StreamItem[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const region = getRegion()

  useEffect(() => {
    let c = false
    setLoading(true)
    setErr(null)
    getBrowseFeed(mode, region)
      .then((d) => {
        if (!c) setItems(Array.isArray(d) ? d : [])
      })
      .catch((e: Error) => {
        if (!c) setErr(e.message)
      })
      .finally(() => {
        if (!c) setLoading(false)
      })
    return () => {
      c = true
    }
  }, [region, mode])

  return (
    <div className="page home-page">
      <header className="top home-header">
        <h1 className="logo home-logo">
          <span className="logo-mark" aria-hidden="true">
            <Play size={16} fill="currentColor" strokeWidth={2} />
          </span>
          <span>TubePWA</span>
        </h1>
        <span className="region-badge" aria-label={`Content region ${region}`}>
          <Globe2 size={15} strokeWidth={2} aria-hidden="true" />
          <span>{region}</span>
        </span>
      </header>

      <div className="home-value">
        <ShieldCheck size={18} strokeWidth={2} aria-hidden="true" />
        <p className="hint">
          Browse videos in a focused player, with no APK or API keys required.
          Your history stays on this device.
        </p>
      </div>

      <div className="pad-x home-controls">
        <OpenLinkBar />
        <div className="tabs feed-tabs" role="group" aria-label="Choose video feed">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab feed-tab${mode === t.id ? ' on is-active' : ''}`}
              onClick={() => setMode(t.id)}
              aria-pressed={mode === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <section
        id="home-feed"
        className="home-feed"
        aria-labelledby="home-feed-heading"
        aria-busy={loading}
      >
        <h2 id="home-feed-heading" className="sr-only">
          {TABS.find((tab) => tab.id === mode)?.label} videos
        </h2>

        {loading && (
          <>
            <p className="sr-only" role="status">
              Loading videos…
            </p>
            <div className="grid skeleton-grid" aria-hidden="true">
              {SKELETON_CARDS.map((index) => (
                <article className="video-card video-card-skeleton" key={index}>
                  <div className="thumb skeleton skeleton-thumbnail" />
                  <div className="meta video-card-meta skeleton-meta">
                    <div className="avatar skeleton skeleton-avatar" />
                    <div className="skeleton-copy">
                      <div className="skeleton skeleton-line skeleton-line-title" />
                      <div className="skeleton skeleton-line skeleton-line-meta" />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {err && (
          <div className="error home-error" role="alert">
            <TriangleAlert size={20} strokeWidth={2} aria-hidden="true" />
            <div>
              <strong>Could not load this feed</strong>
              <p>{err}</p>
            </div>
          </div>
        )}

        {!loading && !err && items.length === 0 && (
          <div className="empty empty-state home-empty">
            <Film size={28} strokeWidth={1.8} aria-hidden="true" />
            <h2>No videos found</h2>
            <p>Try another feed or search for something specific.</p>
            <Link className="btn empty-state-action" to="/search">
              <Search size={17} strokeWidth={2} aria-hidden="true" />
              Search videos
            </Link>
          </div>
        )}

        {!loading && !err && items.length > 0 && <VideoGrid items={items} />}
      </section>
    </div>
  )
}
