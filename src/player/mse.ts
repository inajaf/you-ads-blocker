/** MediaSource helpers for adaptive (video-only + audio) at max quality. */

import { fetchMediaBuffer } from './mediaFetch'

function pickVideoType(mime: string | undefined): string {
  const m = String(mime || '')
  if (m.includes('codecs') && MediaSource.isTypeSupported(m)) return m
  const candidates = [
    m,
    'video/mp4; codecs="avc1.640028"',
    'video/mp4; codecs="avc1.64001F"',
    'video/mp4; codecs="avc1.4d401f"',
    'video/mp4; codecs="avc1.4d401e"',
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.42001E"',
    'video/webm; codecs="vp9"',
    'video/webm; codecs="vp09.00.51.08"',
    'video/mp4',
  ]
  return (
    candidates.find((t) => t && MediaSource.isTypeSupported(t)) ||
    'video/mp4; codecs="avc1.4d401f"'
  )
}

function pickAudioType(mime: string | undefined): string {
  const m = String(mime || '')
  if (m.includes('codecs') && MediaSource.isTypeSupported(m)) return m
  const candidates = [
    m,
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/mp4; codecs="mp4a.40.5"',
    'audio/webm; codecs="opus"',
    'audio/mp4',
  ]
  return (
    candidates.find((t) => t && MediaSource.isTypeSupported(t)) ||
    'audio/mp4; codecs="mp4a.40.2"'
  )
}

function appendBuffer(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sb.updating) {
      sb.addEventListener(
        'updateend',
        () => {
          appendBuffer(sb, data).then(resolve, reject)
        },
        { once: true },
      )
      return
    }
    const onEnd = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error('SourceBuffer error'))
    }
    const cleanup = () => {
      sb.removeEventListener('updateend', onEnd)
      sb.removeEventListener('error', onErr)
    }
    sb.addEventListener('updateend', onEnd)
    sb.addEventListener('error', onErr)
    try {
      sb.appendBuffer(data)
    } catch (e) {
      cleanup()
      reject(e)
    }
  })
}

export interface MseSession {
  destroy: () => void
}

/**
 * Play adaptive video+audio at high quality via MediaSource.
 * Bytes come through SW/server media proxy (CORS-safe).
 */
export async function playAdaptiveMse(
  video: HTMLVideoElement,
  opts: {
    videoUrl: string
    audioUrl: string
    videoMime?: string
    audioMime?: string
    signal?: AbortSignal
    onProgress?: (phase: string) => void
  },
): Promise<MseSession> {
  if (!window.MediaSource) {
    throw new Error('MediaSource not supported')
  }

  const ms = new MediaSource()
  const objectUrl = URL.createObjectURL(ms)
  video.src = objectUrl

  let destroyed = false
  const destroy = () => {
    destroyed = true
    try {
      if (video.src === objectUrl) {
        video.removeAttribute('src')
        video.load()
      }
    } catch {
      /* ignore */
    }
    try {
      URL.revokeObjectURL(objectUrl)
    } catch {
      /* ignore */
    }
    try {
      if (ms.readyState === 'open') ms.endOfStream()
    } catch {
      /* ignore */
    }
  }

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sourceopen timeout')), 10000)
    ms.addEventListener(
      'sourceopen',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })

  if (opts.signal?.aborted || destroyed) {
    destroy()
    throw new Error('aborted')
  }

  const vType = pickVideoType(opts.videoMime)
  const aType = pickAudioType(opts.audioMime)

  if (!MediaSource.isTypeSupported(vType) || !MediaSource.isTypeSupported(aType)) {
    destroy()
    throw new Error(`unsupported types ${vType} / ${aType}`)
  }

  const vsb = ms.addSourceBuffer(vType)
  const asb = ms.addSourceBuffer(aType)
  // segments mode is default for fMP4/DASH progressive files
  try {
    if ('mode' in vsb) (vsb as SourceBuffer & { mode: string }).mode = 'segments'
    if ('mode' in asb) (asb as SourceBuffer & { mode: string }).mode = 'segments'
  } catch {
    /* ignore */
  }

  opts.onProgress?.('downloading')
  const [vBuf, aBuf] = await Promise.all([
    fetchMediaBuffer(opts.videoUrl, opts.signal),
    fetchMediaBuffer(opts.audioUrl, opts.signal),
  ])

  if (opts.signal?.aborted || destroyed) {
    destroy()
    throw new Error('aborted')
  }

  opts.onProgress?.('buffering')
  await appendBuffer(vsb, vBuf)
  await appendBuffer(asb, aBuf)

  try {
    if (ms.readyState === 'open') ms.endOfStream()
  } catch {
    /* ignore */
  }

  return { destroy }
}

export function canUseMse(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaSource !== 'undefined'
}
