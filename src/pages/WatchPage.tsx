import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Bookmark,
  ChevronDown,
  ExternalLink,
  Heart,
  Home,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getStreams } from '../api/client'
import type { VideoStreamsResponse } from '../api/types'
import { decidePlayback } from '../player/playbackPolicy'
import { detectPlaybackEnvironment, useShieldStatus } from '../player/shieldStatus'
import { YoutubeEmbedPlayer } from '../player/YoutubeEmbedPlayer'
import {
  getHistory,
  isLiked,
  isWatchLater,
  toggleLike,
  toggleWatchLater,
  updateProgress,
  upsertHistory,
} from '../store/library'

const VideoPlayer = lazy(() =>
  import('../player/VideoPlayer').then((module) => ({ default: module.VideoPlayer })),
)

interface LightMeta {
  title: string
  author: string
  thumbnail: string
}

async function fetchLightMeta(id: string): Promise<LightMeta> {
  const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  try {
    const r = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (r.ok) {
      const j = (await r.json()) as {
        title?: string
        author_name?: string
        thumbnail_url?: string
      }
      return {
        title: j.title || id,
        author: j.author_name || '',
        thumbnail: j.thumbnail_url || thumb,
      }
    }
  } catch {
    /* use the stable thumbnail fallback */
  }
  return { title: id, author: '', thumbnail: thumb }
}

function PlayerSkeleton() {
  return (
    <div className="player-wrap player-state" aria-live="polite">
      <div className="player-viewport">
        <div className="player-video skeleton player-skeleton" />
      </div>
      <span className="sr-only">Preparing player</span>
    </div>
  )
}

function ShieldGate({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="player-wrap player-state shield-gate" aria-live="polite">
      <div className="player-viewport">
        <div className="shield-gate-icon" aria-hidden="true">
          <ShieldAlert size={28} />
        </div>
      </div>
      <div>
        <p className="eyebrow">Desktop protection required</p>
        <h2>Turn on Noirva Shield to start the embed</h2>
        <p className="muted">
          The YouTube iframe stays unloaded until the extension confirms that
          blocking is active, so ad requests cannot start in the background.
        </p>
        <ol className="setup-steps">
          <li>Run <code>npm run build:extension</code>.</li>
          <li>Open Chrome extensions and enable Developer mode.</li>
          <li>Load the <code>dist-extension</code> folder and enable Shield.</li>
        </ol>
        <button type="button" className="btn" onClick={onRetry}>
          <RefreshCw size={17} aria-hidden="true" />
          Check again
        </button>
      </div>
    </section>
  )
}

export function WatchPage() {
  const { id = '' } = useParams()
  const [environment] = useState(detectPlaybackEnvironment)
  const shield = useShieldStatus()
  const playback = decidePlayback(environment, shield)
  const [meta, setMeta] = useState<LightMeta | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [startAt, setStartAt] = useState(0)
  const [liked, setLiked] = useState(false)
  const [later, setLater] = useState(false)
  const [streams, setStreams] = useState<VideoStreamsResponse | null>(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamErr, setStreamErr] = useState<string | null>(null)
  const streamRequestRef = useRef(false)

  useEffect(() => {
    if (!id || !/^[\w-]{11}$/.test(id)) {
      setErr('Invalid video id')
      setLoading(false)
      return
    }
    let cancelled = false
    streamRequestRef.current = false
    setLoading(true)
    setErr(null)
    setStreams(null)
    setStreamErr(null)
    ;(async () => {
      try {
        const [m, hist] = await Promise.all([fetchLightMeta(id), getHistory(id)])
        if (cancelled) return
        setMeta(m)
        setStartAt(hist && hist.progressSec > 5 ? hist.progressSec : 0)
        setLiked(await isLiked(id))
        setLater(await isWatchLater(id))
        await upsertHistory({
          videoId: id,
          title: m.title,
          thumbnail: m.thumbnail,
          uploader: m.author,
          duration: hist?.duration ?? 0,
          progressSec: hist?.progressSec ?? 0,
        })
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const onProgress = useCallback(
    (sec: number) => {
      void updateProgress(id, sec)
    },
    [id],
  )

  const loadMobileStream = useCallback(async () => {
    if (!id || streams || streamRequestRef.current) return
    streamRequestRef.current = true
    setStreamLoading(true)
    setStreamErr(null)
    try {
      const data = await getStreams(id)
      setStreams(data)
      if (data.title) {
        setMeta((current) =>
          current
            ? {
                ...current,
                title: data.title || current.title,
                author: data.uploader || current.author,
                thumbnail: data.thumbnailUrl || current.thumbnail,
              }
            : current,
        )
      }
    } catch (e) {
      setStreamErr(e instanceof Error ? e.message : 'Stream failed')
    } finally {
      streamRequestRef.current = false
      setStreamLoading(false)
    }
  }, [id, streams])

  useEffect(() => {
    if (playback.mode === 'stream') void loadMobileStream()
  }, [loadMobileStream, playback.mode])

  if (loading) {
    return (
      <div className="page watch">
        <PlayerSkeleton />
        <div className="watch-body">
          <div className="skeleton skeleton-line wide" />
          <div className="skeleton skeleton-line" />
        </div>
      </div>
    )
  }

  if (err || !meta) {
    return (
      <div className="page pad-x state-page">
        <div className="error" role="alert">{err || 'Video not found'}</div>
        <Link to="/" className="btn">
          <Home size={17} aria-hidden="true" />
          Home
        </Link>
      </div>
    )
  }

  const likeMeta = {
    videoId: id,
    title: meta.title,
    thumbnail: meta.thumbnail,
    uploader: meta.author,
  }
  const youtubeUrl = `https://www.youtube.com/watch?v=${id}`

  return (
    <div className="page watch">
      {playback.mode === 'checking' && <PlayerSkeleton />}
      {playback.mode === 'shield_required' && <ShieldGate onRetry={shield.refresh} />}
      {playback.mode === 'embed' && (
        <YoutubeEmbedPlayer videoId={id} startAt={startAt} onProgress={onProgress} />
      )}
      {playback.mode === 'stream' && (
        <div data-testid="stream-player-path">
          {streamLoading && <PlayerSkeleton />}
          {streamErr && (
            <div className="player-wrap player-state stream-error" role="alert">
              <div className="player-viewport">
                <Smartphone size={28} aria-hidden="true" />
              </div>
              <h2>Mobile stream is unavailable</h2>
              <p className="muted">{streamErr}</p>
              <div className="row embed-actions">
                <button type="button" className="btn" onClick={() => void loadMobileStream()}>
                  <RefreshCw size={17} aria-hidden="true" />
                  Retry
                </button>
                <a className="btn ghost" href={youtubeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={17} aria-hidden="true" />
                  Open YouTube
                </a>
              </div>
            </div>
          )}
          {!streamLoading && !streamErr && streams && (
            <Suspense fallback={<PlayerSkeleton />}>
              <VideoPlayer data={streams} startAt={startAt} onProgress={onProgress} />
            </Suspense>
          )}
        </div>
      )}

      <div className="watch-body">
        <div className="watch-heading">
          <div>
            <p className="eyebrow">Now playing</p>
            <h1 className="watch-title">{meta.title}</h1>
            {meta.author && <p className="watch-author">{meta.author}</p>}
          </div>
          <div
            className={`status-pill ${
              playback.mode === 'embed'
                ? 'success'
                : playback.mode === 'shield_required'
                  ? 'warning'
                  : 'info'
            }`}
            aria-live="polite"
          >
            {playback.mode === 'embed' ? (
              <ShieldCheck size={16} aria-hidden="true" />
            ) : playback.mode === 'stream' ? (
              <Smartphone size={16} aria-hidden="true" />
            ) : (
              <ShieldAlert size={16} aria-hidden="true" />
            )}
            <span>
              {playback.mode === 'embed'
                ? `Shield detected${shield.state === 'active' && shield.version ? ` · v${shield.version}` : ''}`
                : playback.mode === 'stream'
                  ? 'Mobile stream'
                  : playback.mode === 'checking'
                    ? 'Checking Shield'
                    : 'Shield required'}
            </span>
          </div>
        </div>

        <div className="watch-actions" aria-label="Video actions">
          <button
            type="button"
            className={`chip${liked ? ' on' : ''}`}
            aria-pressed={liked}
            onClick={() => void toggleLike(likeMeta).then(setLiked)}
          >
            <Heart size={18} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
            {liked ? 'Liked' : 'Like'}
          </button>
          <button
            type="button"
            className={`chip${later ? ' on' : ''}`}
            aria-pressed={later}
            onClick={() => void toggleWatchLater(likeMeta).then(setLater)}
          >
            <Bookmark size={18} fill={later ? 'currentColor' : 'none'} aria-hidden="true" />
            {later ? 'Saved' : 'Watch later'}
          </button>
          <a className="chip" href={youtubeUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={18} aria-hidden="true" />
            YouTube
          </a>
        </div>

        <details className="desc">
          <summary>
            How protected playback works
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="desc-content">
            <p>
              Desktop uses the official YouTube embed only after Noirva Shield
              confirms that blocking is enabled. Mobile uses the in-app stream
              player because mobile PWAs cannot control a cross-origin iframe.
            </p>
            <p>
              Videos whose owners disabled embedding can only be opened on
              YouTube. The app never bypasses sign-in, paid, age, region, or DRM
              restrictions.
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
