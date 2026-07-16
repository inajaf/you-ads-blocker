import type { VideoStreamsResponse, PipedStream } from '../api/types'

export interface PlaySource {
  label: string
  url: string
  kind: 'hls' | 'progressive' | 'adaptive'
  audioUrl?: string
  height?: number
  mimeType?: string
  audioMimeType?: string
}

export function streamBrowserScore(stream: {
  url?: string
  mimeType?: string
  quality?: string
  videoOnly?: boolean
  height?: number
}): number {
  if (!stream?.url) return 0
  const u = String(stream.url)
  const m = String(stream.mimeType || '')
  const q = String(stream.quality || '')
  const blob = `${u} ${m} ${q}`
  let score = 10
  if (/googlevideo\.com|\/videoplayback/i.test(u)) score += 100
  if (/pipedproxy|proxy\.piped|\/videoplayback\?/i.test(u)) score += 90
  if (/mpegurl|m3u8|HLS/i.test(blob)) score += 45
  if (/odycdn\.com|lbry\.tv|lbry:\/\//i.test(u) && !/mpegurl|m3u8|HLS/i.test(blob)) {
    score -= 100
  }
  if (!stream.videoOnly && /^video\//i.test(m)) score += 15
  if (stream.videoOnly) score -= 5
  const h = stream.height || 0
  if (h >= 360 && h <= 720) score += 10
  return score
}

function isHlsStream(s: PipedStream): boolean {
  const blob = `${s.mimeType || ''} ${s.quality || ''} ${s.url || ''}`
  return /mpegurl|m3u8|HLS/i.test(blob)
}

function streamHeight(s: PipedStream): number {
  if (s.height && s.height > 0) return s.height
  const m = String(s.quality || '').match(/(\d{3,4})/)
  return m ? Number(m[1]) : 0
}

export function pickBestAudio(audioStreams: PipedStream[] | null | undefined): PipedStream | null {
  const list = (audioStreams || []).filter((a) => a?.url && !isHlsStream(a))
  if (!list.length) return null
  const scored = list.map((a) => {
    let s = streamBrowserScore(a)
    const mime = String(a.mimeType || '')
    if (/mp4|m4a|mp4a|aac/i.test(mime)) s += 40
    if (/webm|opus/i.test(mime)) s += 15
    const br = a.bitrate || 0
    if (br >= 128_000) s += Math.min(40, Math.floor(br / 8000))
    else if (br > 0) s += 5
    return { a, s }
  })
  scored.sort((x, y) => y.s - x.s)
  return scored[0].a
}

function mimePreference(mime: string): number {
  const m = String(mime || '')
  if (/avc1|h264/i.test(m)) return 30
  if (/mp4/i.test(m) && !/webm/i.test(m)) return 25
  if (/vp9|vp09/i.test(m)) return 20
  if (/av01|av1/i.test(m)) return 15
  if (/webm/i.test(m)) return 10
  return 0
}

function formatQualityLabel(quality: string | undefined, height: number): string {
  if (quality && /\d{3,4}p/i.test(quality)) return quality.replace(/\s+/g, '')
  if (height > 0) return `${height}p`
  return quality || 'Video'
}

/** Quality ladder: highest resolution first (1080 → 720 → …). */
export function buildSources(data: VideoStreamsResponse): PlaySource[] {
  const streams = Array.isArray(data.videoStreams) ? data.videoStreams : []
  const audio = pickBestAudio(data.audioStreams)
  const candidates: (PlaySource & { score: number; height: number })[] = []

  if (data.hls) {
    candidates.push({
      label: 'Auto (HLS)',
      url: data.hls,
      kind: 'hls',
      height: 0,
      score: 1,
    })
  }

  const muxedByH = new Map<number, PipedStream & { _score: number }>()
  for (const s of streams.filter((x) => x?.url && !x.videoOnly && !isHlsStream(x))) {
    const score = streamBrowserScore(s)
    if (score <= 0) continue
    const h = streamHeight(s) || 0
    const total = score + mimePreference(s.mimeType)
    const prev = muxedByH.get(h)
    if (!prev || total > prev._score) muxedByH.set(h, { ...s, _score: total })
  }
  for (const [h, s] of muxedByH) {
    candidates.push({
      label: formatQualityLabel(s.quality, h),
      url: s.url,
      kind: 'progressive',
      height: h,
      mimeType: s.mimeType,
      score: s._score,
    })
  }

  if (audio?.url) {
    const voByH = new Map<number, PipedStream & { _score: number }>()
    for (const s of streams.filter((x) => x?.url && x.videoOnly && !isHlsStream(x))) {
      const score = streamBrowserScore(s)
      if (score <= 0) continue
      const h = streamHeight(s)
      if (h < 144) continue
      const total = score + mimePreference(s.mimeType)
      const prev = voByH.get(h)
      if (!prev || total > prev._score) voByH.set(h, { ...s, _score: total })
    }
    for (const [h, s] of voByH) {
      if (muxedByH.has(h)) continue
      candidates.push({
        label: formatQualityLabel(s.quality, h),
        url: s.url,
        kind: 'adaptive',
        audioUrl: audio.url,
        height: h,
        mimeType: s.mimeType,
        audioMimeType: audio.mimeType,
        score: s._score,
      })
    }
  }

  for (const s of streams.filter((x) => x?.url && isHlsStream(x))) {
    candidates.push({
      label: s.quality || 'HLS',
      url: s.url,
      kind: 'hls',
      height: streamHeight(s),
      score: streamBrowserScore(s),
    })
  }

  if (!candidates.length) {
    for (const s of streams.filter((x) => x?.url)) {
      candidates.push({
        label: formatQualityLabel(s.quality, streamHeight(s)),
        url: s.url,
        kind: isHlsStream(s) ? 'hls' : 'progressive',
        height: streamHeight(s),
        score: 0,
      })
    }
  }

  candidates.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height
    // same height: progressive first (more reliable)
    if (a.kind === 'progressive' && b.kind !== 'progressive') return -1
    if (b.kind === 'progressive' && a.kind !== 'progressive') return 1
    return b.score - a.score
  })

  const seen = new Set<string>()
  return candidates
    .filter((s) => {
      if (!s.url || seen.has(s.url)) return false
      seen.add(s.url)
      return true
    })
    .map(({ label, url, kind, audioUrl, height, mimeType, audioMimeType }) => ({
      label,
      url,
      kind,
      audioUrl,
      height,
      mimeType,
      audioMimeType,
    }))
}

/**
 * Stream autoplay default: highest **progressive** (or hls) so playback starts
 * without hanging on adaptive full-file download. Adaptive stays in the menu.
 */
export function pickDefaultSourceIndex(sources: PlaySource[]): number {
  if (!sources.length) return 0

  // 1) Best progressive
  let bestProg = -1
  let bestProgH = -1
  for (let i = 0; i < sources.length; i++) {
    if (sources[i].kind !== 'progressive') continue
    const h = sources[i].height || 0
    if (h > bestProgH) {
      bestProgH = h
      bestProg = i
    }
  }
  if (bestProg >= 0) return bestProg

  // 2) HLS
  const hls = sources.findIndex((s) => s.kind === 'hls')
  if (hls >= 0) return hls

  // 3) Any max height
  let best = 0
  let bestH = -1
  for (let i = 0; i < sources.length; i++) {
    const h = sources[i].height || 0
    if (h > bestH) {
      bestH = h
      best = i
    }
  }
  return best
}

/** Best progressive index for reliable fallback (or -1). */
export function progressiveFallbackIndex(sources: PlaySource[]): number {
  let best = -1
  let bestH = -1
  for (let i = 0; i < sources.length; i++) {
    if (sources[i].kind !== 'progressive') continue
    const h = sources[i].height || 0
    if (h > bestH) {
      bestH = h
      best = i
    }
  }
  return best
}

export function hasPlayerSources(data: VideoStreamsResponse | null | undefined): boolean {
  if (!data) return false
  return buildSources(data).length > 0
}

export function sourceKey(s: PlaySource | null | undefined): string {
  if (!s) return ''
  return `${s.kind}|${s.url}|${s.audioUrl || ''}`
}
