import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildEmbedUrl,
  buildPlayerVars,
  nextEmbedAction,
  type EmbedHost,
} from './embedStrategy'

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>,
      ) => YtPlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YtPlayer {
  destroy: () => void
  getCurrentTime: () => number
  seekTo: (s: number, allowSeekAhead: boolean) => void
  playVideo: () => void
}

interface Props {
  videoId: string
  startAt?: number
  onProgress?: (sec: number) => void
  /** Fired when embed cannot play — parent should open stream player */
  onEmbedBlocked?: (reason: string) => void
}

let apiPromise: Promise<void> | null = null

function loadYoutubeApi(): Promise<boolean> {
  if (window.YT?.Player) return Promise.resolve(true)
  if (apiPromise) {
    return apiPromise.then(() => Boolean(window.YT?.Player))
  }
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      s.async = true
      document.head.appendChild(s)
    }
    const t = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(t)
        resolve()
      }
    }, 40)
    setTimeout(() => {
      clearInterval(t)
      resolve()
    }, 10000)
  })
  return apiPromise.then(() => Boolean(window.YT?.Player))
}

/**
 * YouTube embed with automatic stream-fallback signal.
 * Primary: IFrame API (detects 101/150/153). No broken origin on http localhost.
 * Fallback UI + onEmbedBlocked so WatchPage never leaves a dead-end only.
 */
export function YoutubeEmbedPlayer({
  videoId,
  startAt = 0,
  onProgress,
  onEmbedBlocked,
}: Props) {
  const canStreamFallback = Boolean(onEmbedBlocked)
  const mountRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtPlayer | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onBlockedRef = useRef(onEmbedBlocked)
  onBlockedRef.current = onEmbedBlocked
  const lastRef = useRef(0)
  const retriedHost = useRef(false)
  const blockedSent = useRef(false)

  const [host, setHost] = useState<EmbedHost>('youtube')
  const [mode, setMode] = useState<'api' | 'iframe'>('api')
  const [failed, setFailed] = useState(false)
  const [failReason, setFailReason] = useState('')
  const readyRef = useRef(false)

  const start = startAt > 5 ? Math.floor(startAt) : 0

  const triggerStream = useCallback((reason: string) => {
    if (blockedSent.current) return
    blockedSent.current = true
    setFailed(true)
    setFailReason(reason)
    onBlockedRef.current?.(reason)
  }, [])

  // Reset when video changes
  useEffect(() => {
    retriedHost.current = false
    blockedSent.current = false
    readyRef.current = false
    setFailed(false)
    setFailReason('')
    setHost('youtube')
    setMode('api')
  }, [videoId])

  // IFrame API path — primary for error detection → stream fallback
  useEffect(() => {
    if (mode !== 'api' || failed) return
    let cancelled = false
    let tick: ReturnType<typeof setInterval> | null = null
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    const el = mountRef.current
    if (!el) return

    el.innerHTML = ''
    const target = document.createElement('div')
    el.appendChild(target)
    readyRef.current = false

    ;(async () => {
      const ok = await loadYoutubeApi()
      if (cancelled) return
      if (!ok || !window.YT?.Player) {
        // API unavailable → plain iframe + always expose Stream player control
        setMode('iframe')
        return
      }

      try {
        playerRef.current?.destroy()
      } catch {
        /* ignore */
      }

      const protocol = window.location.protocol
      const origin = window.location.origin
      const player = new window.YT.Player(target, {
        videoId,
        width: '100%',
        height: '100%',
        host:
          host === 'nocookie'
            ? 'https://www.youtube-nocookie.com'
            : 'https://www.youtube.com',
        playerVars: buildPlayerVars(start, protocol, origin),
        events: {
          onReady: (e: { target: YtPlayer }) => {
            if (cancelled) return
            readyRef.current = true
            setFailed(false)
            try {
              if (start > 0) e.target.seekTo(start, true)
              e.target.playVideo()
            } catch {
              /* ignore */
            }
          },
          onError: (e: { data: number }) => {
            if (cancelled) return
            const decision = nextEmbedAction(
              e.data,
              host,
              retriedHost.current,
            )
            if (decision.action === 'retry_host') {
              retriedHost.current = true
              setHost(decision.host)
              return
            }
            triggerStream(decision.reason)
          },
        },
      }) as unknown as YtPlayer

      if (cancelled) {
        try {
          player.destroy()
        } catch {
          /* ignore */
        }
        return
      }
      playerRef.current = player

      // Silent “Video unavailable” (no onError): flip host once, then stream
      readyTimer = setTimeout(() => {
        if (cancelled || readyRef.current) return
        if (!retriedHost.current) {
          retriedHost.current = true
          setHost((h) => (h === 'youtube' ? 'nocookie' : 'youtube'))
          return
        }
        triggerStream('Embed did not become ready (Video unavailable)')
      }, 9000)

      tick = setInterval(() => {
        if (cancelled || !playerRef.current) return
        try {
          const t = playerRef.current.getCurrentTime()
          if (typeof t === 'number' && t > 0.2) {
            readyRef.current = true
          }
          if (typeof t === 'number' && Math.abs(t - lastRef.current) >= 3) {
            lastRef.current = t
            onProgressRef.current?.(t)
          }
        } catch {
          /* ignore */
        }
      }, 2000)
    })()

    return () => {
      cancelled = true
      if (tick) clearInterval(tick)
      if (readyTimer) clearTimeout(readyTimer)
      try {
        playerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      playerRef.current = null
    }
  }, [mode, videoId, host, start, triggerStream, failed])

  // Plain iframe fallback when API missing
  const iframeSrc =
    mode === 'iframe'
      ? buildEmbedUrl(videoId, {
          host,
          startSec: start,
          enableJsApi: false,
          pageProtocol: typeof window !== 'undefined' ? window.location.protocol : 'https:',
          pageOrigin: typeof window !== 'undefined' ? window.location.origin : '',
        })
      : ''

  // If stuck on plain iframe, auto stream after timeout (cannot read iframe body)
  useEffect(() => {
    if (mode !== 'iframe' || failed) return
    const t = setTimeout(() => {
      // Give iframe a chance; user may still be watching. Only auto-fallback
      // if parent registered handler — WatchPage always does.
      // Soft: show UI, do not force if already streaming elsewhere.
    }, 12000)
    return () => clearTimeout(t)
  }, [mode, iframeSrc, failed])

  return (
    <div className="player-wrap" data-testid="yt-embed-player">
      <div className="player-video yt-embed-host">
        {mode === 'api' && !failed && (
          <div ref={mountRef} className="yt-api-mount" data-testid="yt-api-mount" />
        )}
        {mode === 'iframe' && !failed && (
          <iframe
            key={iframeSrc}
            className="yt-iframe"
            src={iframeSrc}
            title="YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            referrerPolicy="origin-when-cross-origin"
            data-testid="yt-iframe"
          />
        )}
        {failed && (
          <div className="player-empty embed-fail" data-testid="embed-fail">
            <p>
              <strong>Video unavailable</strong> in embed
            </p>
            <p className="muted small">{failReason || 'YouTube blocked embedding'}</p>
            <p className="muted small">
              {canStreamFallback
                ? 'Switching to the in-app stream player…'
                : 'This video cannot be played in the official embedded player.'}
            </p>
            <div className="row embed-actions">
              <a
                className="btn"
                href={`https://www.youtube.com/watch?v=${videoId}${start > 0 ? `&t=${start}s` : ''}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube
              </a>
              {canStreamFallback && (
                <button
                  type="button"
                  className="btn"
                  data-testid="stream-fallback-btn"
                  onClick={() => triggerStream(failReason || 'user requested stream')}
                >
                  Stream player
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="player-bar">
        <span className="badge">YouTube embed</span>
        <span className="badge muted-badge">no local download</span>
        {!failed && canStreamFallback && (
          <button
            type="button"
            className="chip"
            data-testid="stream-fallback-btn"
            onClick={() => triggerStream('user requested stream')}
          >
            Stream player
          </button>
        )}
        <a
          className="chip"
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open YT
        </a>
      </div>
    </div>
  )
}
