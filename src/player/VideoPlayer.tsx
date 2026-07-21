import { useEffect, useMemo, useRef, useState } from 'react'
import type HlsType from 'hls.js'
import type { VideoStreamsResponse } from '../api/types'
import {
  buildSources,
  pickDefaultSourceIndex,
  progressiveFallbackIndex,
  sourceKey,
  type PlaySource,
} from './sources'
import { canUseMse, playAdaptiveMse, type MseSession } from './mse'
import { Maximize, Minimize } from 'lucide-react'

interface Props {
  data: VideoStreamsResponse
  startAt?: number
  onProgress?: (sec: number) => void
}

function hardResetMedia(
  video: HTMLVideoElement,
  audio: HTMLAudioElement | null,
  hls: HlsType | null,
  mse: MseSession | null,
) {
  try {
    hls?.destroy()
  } catch {
    /* ignore */
  }
  try {
    mse?.destroy()
  } catch {
    /* ignore */
  }
  try {
    video.pause()
  } catch {
    /* ignore */
  }
  try {
    const s = video.src
    if (s?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(s)
      } catch {
        /* ignore */
      }
    }
    video.removeAttribute('src')
    video.load()
  } catch {
    /* ignore */
  }
  if (audio) {
    try {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    } catch {
      /* ignore */
    }
  }
}

export function VideoPlayer({ data, startAt = 0, onProgress }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<HlsType | null>(null)
  const mseRef = useRef<MseSession | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const genRef = useRef(0)

  const sources = useMemo(() => buildSources(data), [data])
  const maxIdx = useMemo(() => pickDefaultSourceIndex(sources), [sources])
  const progIdx = useMemo(() => progressiveFallbackIndex(sources), [sources])

  const [sourceIdx, setSourceIdx] = useState(maxIdx)
  const [status, setStatus] = useState<string | null>(null)
  /** Forces effect re-run on every quality change (even same index retry). */
  const [switchGen, setSwitchGen] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const source: PlaySource | null = sources[sourceIdx] || null
  const key = `${sourceKey(source)}#${switchGen}`

  const last = useRef(0)
  const resumeAt = useRef(0)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  const mediaId = `${data.title}|${data.thumbnailUrl}|${data.duration}`

  // New video → aim for max quality (1080 if available)
  useEffect(() => {
    const next = buildSources(data)
    const max = pickDefaultSourceIndex(next)
    setSourceIdx(max)
    resumeAt.current = startAt > 5 ? startAt : 0
    last.current = 0
    setStatus(null)
    setSwitchGen((g) => g + 1)
  }, [mediaId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source) return

    const gen = ++genRef.current
    const alive = () => gen === genRef.current

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    hardResetMedia(video, audioRef.current, hlsRef.current, mseRef.current)
    hlsRef.current = null
    mseRef.current = null

    const seekAndPlay = () => {
      if (!alive()) return
      const t = resumeAt.current
      if (t > 0.25) {
        try {
          const dur = video.duration
          video.currentTime =
            Number.isFinite(dur) && dur > 0 ? Math.min(t, Math.max(0, dur - 0.15)) : t
        } catch {
          /* ignore */
        }
      }
      setStatus(null)
      void video.play().catch(() => undefined)
    }

    const goTo = (idx: number) => {
      if (!alive() || idx < 0 || idx >= sources.length || idx === sourceIdx) return
      if (video.currentTime > 0.25) resumeAt.current = video.currentTime
      setSourceIdx(idx)
      setSwitchGen((g) => g + 1)
    }

    const loadProgressive = (url: string) =>
      new Promise<void>((resolve, reject) => {
        const onMeta = () => {
          cleanup()
          resolve()
        }
        const onErr = () => {
          cleanup()
          reject(new Error('media error'))
        }
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onMeta)
          video.removeEventListener('error', onErr)
        }
        video.addEventListener('loadedmetadata', onMeta)
        video.addEventListener('error', onErr)
        video.src = url
        try {
          video.load()
        } catch {
          /* ignore */
        }
      })

    const run = async () => {
      // Progressive — instant switch
      if (source.kind === 'progressive') {
        setStatus(`Switching to ${source.label}…`)
        try {
          await loadProgressive(source.url)
          if (!alive()) return
          seekAndPlay()
        } catch {
          if (!alive()) return
          setStatus(`${source.label} failed`)
          // try another progressive
          for (let i = 0; i < sources.length; i++) {
            if (sources[i].kind === 'progressive' && i !== sourceIdx) {
              goTo(i)
              return
            }
          }
        }
        return
      }

      // HLS
      if (source.kind === 'hls') {
        setStatus(`Loading ${source.label}…`)
        const Hls = (await import('hls.js')).default
        if (!alive()) return
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            startLevel: -1,
            xhrSetup(xhr) {
              xhr.withCredentials = false
            },
          })
          hlsRef.current = hls
          hls.loadSource(source.url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
            if (!alive()) return
            if (d.levels?.length) hls.currentLevel = d.levels.length - 1
            seekAndPlay()
          })
          hls.on(Hls.Events.ERROR, (_e, d) => {
            if (!alive() || !d.fatal) return
            try {
              hls.destroy()
            } catch {
              /* ignore */
            }
            hlsRef.current = null
            if (progIdx >= 0) goTo(progIdx)
            else setStatus(`${source.label} failed`)
          })
          setTimeout(() => {
            if (alive() && video.readyState < 2) {
              try {
                hls.destroy()
              } catch {
                /* ignore */
              }
              hlsRef.current = null
              if (progIdx >= 0) goTo(progIdx)
            }
          }, 10000)
          return
        }
        try {
          await loadProgressive(source.url)
          if (alive()) seekAndPlay()
        } catch {
          if (alive() && progIdx >= 0) goTo(progIdx)
        }
        return
      }

      // Adaptive (1080 / 720)
      if (source.kind === 'adaptive' && source.audioUrl && canUseMse()) {
        setStatus(`Loading ${source.label}…`)

        // Bridge: start progressive immediately so UI never blanks while max loads
        if (progIdx >= 0 && sources[progIdx]) {
          try {
            await loadProgressive(sources[progIdx].url)
            if (!alive()) return
            seekAndPlay()
            setStatus(`Upgrading to ${source.label}…`)
          } catch {
            /* try adaptive alone */
          }
        }

        const keepTime = () => {
          if (video.currentTime > 0.25) resumeAt.current = video.currentTime
        }

        const timer = setTimeout(() => {
          if (!alive()) return
          // Adaptive slow — keep progressive playback, update select to progressive
          if (video.readyState >= 2) {
            setStatus(null)
            if (progIdx >= 0 && sourceIdx !== progIdx) {
              // reflect actual playing quality without full reload
              setSourceIdx(progIdx)
            }
            return
          }
          ac.abort()
          if (progIdx >= 0) goTo(progIdx)
        }, 15000)

        try {
          keepTime()
          const session = await playAdaptiveMse(video, {
            videoUrl: source.url,
            audioUrl: source.audioUrl,
            videoMime: source.mimeType,
            audioMime: source.audioMimeType,
            signal: ac.signal,
            onProgress: (phase) => {
              if (!alive()) return
              setStatus(
                phase === 'downloading'
                  ? `Loading ${source.label}…`
                  : `Buffering ${source.label}…`,
              )
            },
          })
          clearTimeout(timer)
          if (!alive()) {
            session.destroy()
            return
          }
          mseRef.current = session
          keepTime()
          if (video.readyState >= 1) seekAndPlay()
          else {
            video.addEventListener('loadedmetadata', seekAndPlay, { once: true })
            setTimeout(() => {
              if (alive() && video.readyState >= 1) seekAndPlay()
            }, 300)
          }
        } catch {
          clearTimeout(timer)
          if (!alive()) return
          // Stay on progressive if already playing
          if (video.readyState >= 2 && progIdx >= 0) {
            setStatus(null)
            // Reload progressive cleanly after failed MSE
            goTo(progIdx)
            return
          }
          if (progIdx >= 0) goTo(progIdx)
          else setStatus(`${source.label} unavailable`)
        }
        return
      }

      // Unknown
      if (source.url) {
        try {
          await loadProgressive(source.url)
          if (alive()) seekAndPlay()
        } catch {
          if (alive()) setStatus('Playback failed')
        }
      }
    }

    void run()

    const onTime = () => {
      const t = video.currentTime
      if (Math.abs(t - last.current) >= 3) {
        last.current = t
        onProgressRef.current?.(t)
      }
    }
    video.addEventListener('timeupdate', onTime)

    return () => {
      if (genRef.current === gen) genRef.current++
      ac.abort()
      video.removeEventListener('timeupdate', onTime)
      hardResetMedia(video, audioRef.current, hlsRef.current, mseRef.current)
      hlsRef.current = null
      mseRef.current = null
    }
  }, [key, sourceIdx, sources, progIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Quality menu — always applies immediately. */
  const changeQuality = (idx: number) => {
    if (idx < 0 || idx >= sources.length) return
    const v = videoRef.current
    const t = v?.currentTime || 0
    if (t > 0.25) resumeAt.current = t
    setStatus(`Switching to ${sources[idx].label}…`)
    setSourceIdx(idx)
    setSwitchGen((g) => g + 1)
  }

  const toggleFullscreen = () => {
    const el = wrapRef.current
    if (!el) return
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> }
    const elAny = el as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen()
      } else if (elAny.webkitRequestFullscreen) {
        elAny.webkitRequestFullscreen()
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen()
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen()
      }
    }
  }

  useEffect(() => {
    const onFs = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null }
      setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
    }
  }, [])

  if (!sources.length) {
    return (
      <div className="player-wrap">
        <div className="player-empty">No playable source for this video.</div>
      </div>
    )
  }

  const maxH = Math.max(0, ...sources.map((s) => s.height || 0))
  const playing = sources[sourceIdx]

  return (
    <div className="player-wrap" ref={wrapRef}>
      <div className="player-viewport">
        <video
          ref={videoRef}
          className="player-video"
          controls
          playsInline
          poster={data.thumbnailUrl}
        />
        <button
          type="button"
          className="player-expand"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      <div className="player-bar">
        <label className="quality-label">
          <span className="muted-badge">Quality</span>
          <select
            className="chip quality-select"
            value={String(sourceIdx)}
            onChange={(e) => changeQuality(Number(e.target.value))}
          >
            {sources.map((s, i) => (
              <option key={sourceKey(s) + i} value={i}>
                {s.label}
                {s.height === maxH && s.height > 0 ? ' · max' : ''}
              </option>
            ))}
          </select>
        </label>
        {status && <span className="badge muted-badge">{status}</span>}
        {!status && playing && (
          <span className="badge">
            {playing.height ? `${playing.height}p` : playing.label}
            {playing.height === maxH && playing.height > 0 ? ' max' : ''}
          </span>
        )}
        {data._source && <span className="badge muted-badge">{data._source}</span>}
      </div>
    </div>
  )
}
