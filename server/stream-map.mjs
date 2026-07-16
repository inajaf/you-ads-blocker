/**
 * Pure mapping of player/API payloads → TubePWA stream shape.
 * Unit-tested offline without network.
 */

export function parseHeight(label, quality) {
  const m = String(label || quality || '').match(/(\d{3,4})/)
  return m ? Number(m[1]) : 0
}

export function mapFormat(f, videoOnly) {
  // Keep full mime including codecs="…" — needed for MediaSource adaptive playback
  const mime = String(f.mimeType || f.type || '')
  const height = parseHeight(f.qualityLabel || f.quality, f.quality)
  const url = f.url || f.streamUrl || ''
  return {
    bitrate: f.bitrate || f.averageBitrate || 0,
    mimeType: mime || 'video/mp4',
    quality:
      f.qualityLabel || f.audioQuality || f.quality || f.container || `${height || '?'}p`,
    url,
    videoOnly: Boolean(videoOnly),
    height: height || f.height || undefined,
    width: f.width,
    fps: f.fps || 0,
  }
}

/** InnerTube player JSON → Piped-like streams object or null */
export function mapInnerTubePlayerResponse(data, videoId) {
  if (!data || typeof data !== 'object') return null
  const status = data.playabilityStatus?.status
  if (status && status !== 'OK') return null

  const details = data.videoDetails || {}
  const sd = data.streamingData || {}
  const muxed = (sd.formats || []).filter((f) => f.url)
  const adaptive = (sd.adaptiveFormats || []).filter((f) => f.url)
  const videoStreams = [
    ...muxed.map((f) => mapFormat(f, false)),
    ...adaptive
      .filter((f) => String(f.mimeType || '').startsWith('video/'))
      .map((f) => mapFormat(f, true)),
  ]
  const audioStreams = adaptive
    .filter((f) => String(f.mimeType || '').startsWith('audio/'))
    .map((f) => mapFormat(f, false))

  if (!videoStreams.length && !sd.hlsManifestUrl && !audioStreams.length) return null

  const thumbs = details.thumbnail?.thumbnails || []
  return {
    title: details.title || videoId,
    description: details.shortDescription || '',
    uploadDate: '',
    uploader: details.author || '',
    uploaderUrl: details.channelId ? `/channel/${details.channelId}` : '',
    uploaderAvatar: '',
    thumbnailUrl:
      (thumbs.length ? thumbs[thumbs.length - 1].url : '') ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    hls: sd.hlsManifestUrl || null,
    dash: sd.dashManifestUrl || null,
    duration: Number(details.lengthSeconds) || 0,
    views: Number(details.viewCount) || 0,
    likes: 0,
    livestream: Boolean(details.isLiveContent),
    audioStreams,
    videoStreams,
    relatedStreams: [],
    subtitles: [],
    _source: 'innertube',
  }
}

/** Invidious /api/v1/videos/:id → Piped-like streams */
export function mapInvidiousVideo(data, videoId) {
  if (!data || typeof data !== 'object') return null
  if (data.error) return null

  const formatStreams = data.formatStreams || []
  const adaptive = data.adaptiveFormats || []

  const videoStreams = [
    ...formatStreams
      .filter((f) => f.url)
      .map((f) =>
        mapFormat(
          {
            url: f.url,
            mimeType: f.type,
            qualityLabel: f.qualityLabel || f.quality,
            bitrate: f.bitrate,
            fps: f.fps,
          },
          false,
        ),
      ),
    ...adaptive
      .filter((f) => f.url && String(f.type || '').startsWith('video/'))
      .map((f) =>
        mapFormat(
          {
            url: f.url,
            mimeType: f.type,
            qualityLabel: f.qualityLabel || f.quality,
            bitrate: f.bitrate,
            fps: f.fps,
          },
          true,
        ),
      ),
  ]

  const audioStreams = adaptive
    .filter((f) => f.url && String(f.type || '').startsWith('audio/'))
    .map((f) =>
      mapFormat(
        {
          url: f.url,
          mimeType: f.type,
          qualityLabel: f.quality || f.container,
          bitrate: f.bitrate,
        },
        false,
      ),
    )

  const hls = data.hlsUrl || data.hls || null
  if (!videoStreams.length && !hls && !audioStreams.length) return null

  const thumbs = data.videoThumbnails || []
  const thumb =
    thumbs.find((t) => t.quality === 'medium')?.url ||
    thumbs[0]?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  return {
    title: data.title || videoId,
    description: data.description || '',
    uploadDate: data.publishedText || '',
    uploader: data.author || '',
    uploaderUrl: data.authorId ? `/channel/${data.authorId}` : '',
    uploaderAvatar: data.authorThumbnails?.slice?.(-1)?.[0]?.url || '',
    thumbnailUrl: thumb,
    hls,
    dash: data.dashUrl || null,
    duration: Number(data.lengthSeconds) || 0,
    views: Number(data.viewCount) || 0,
    likes: Number(data.likeCount) || 0,
    livestream: Boolean(data.liveNow),
    audioStreams,
    videoStreams,
    relatedStreams: (data.recommendedVideos || []).map((r) => ({
      url: `/watch?v=${r.videoId}`,
      type: 'stream',
      title: r.title || '',
      thumbnail: r.videoThumbnails?.slice?.(-1)?.[0]?.url || '',
      uploaderName: r.author || '',
      duration: r.lengthSeconds || 0,
      views: r.viewCount || 0,
    })),
    subtitles: [],
    _source: 'invidious',
  }
}

/** True if payload has something the player can try */
export function hasPlayableSources(payload) {
  if (!payload || typeof payload !== 'object') return false
  if (payload.hls) return true
  if (Array.isArray(payload.videoStreams) && payload.videoStreams.some((s) => s?.url))
    return true
  if (Array.isArray(payload.audioStreams) && payload.audioStreams.some((s) => s?.url))
    return true
  return false
}

/**
 * Score how likely a stream URL is to play in a mobile browser <video>/hls.js.
 * Piped often returns LBRY/odycdn progressive MP4 that 401 in the browser — deprioritize.
 */
export function streamBrowserScore(stream) {
  if (!stream?.url) return 0
  const u = String(stream.url)
  const m = String(stream.mimeType || '')
  const q = String(stream.quality || '')
  const blob = `${u} ${m} ${q}`
  let score = 10
  if (/googlevideo\.com|\/videoplayback/i.test(u)) score += 100
  if (/pipedproxy|proxy\.piped|\/videoplayback\?/i.test(u)) score += 90
  if (/mpegurl|m3u8|HLS/i.test(blob)) score += 45
  // Odysee/LBRY progressive often 401 in browser
  if (/odycdn\.com|lbry\.tv|lbry:\/\//i.test(u) && !/mpegurl|m3u8|HLS/i.test(blob)) {
    score -= 100
  }
  if (!stream.videoOnly && /^video\//i.test(m)) score += 15
  if (stream.videoOnly) score -= 5
  const h = stream.height || parseHeight(q, '')
  if (h >= 360 && h <= 720) score += 10
  return score
}

export function browserPlayScore(payload) {
  if (!payload || typeof payload !== 'object') return -1
  let best = 0
  if (payload.hls) {
    best = Math.max(
      best,
      streamBrowserScore({ url: payload.hls, mimeType: 'application/x-mpegurl', quality: 'HLS' }),
    )
  }
  for (const s of payload.videoStreams || []) {
    best = Math.max(best, streamBrowserScore(s))
  }
  for (const s of payload.audioStreams || []) {
    best = Math.max(best, streamBrowserScore(s))
  }
  return best
}

/** Reorder streams so browser-friendly URLs come first; pull LBRY HLS into hls field when useful. */
export function rankStreamsForBrowser(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const videoStreams = [...(payload.videoStreams || [])].sort(
    (a, b) => streamBrowserScore(b) - streamBrowserScore(a),
  )
  const audioStreams = [...(payload.audioStreams || [])].sort(
    (a, b) => streamBrowserScore(b) - streamBrowserScore(a),
  )
  let hls = payload.hls || null
  if (!hls) {
    const hlsStream = videoStreams.find(
      (s) =>
        /mpegurl|m3u8/i.test(String(s.mimeType || '')) ||
        /HLS/i.test(String(s.quality || '')) ||
        /\.m3u8/i.test(String(s.url || '')),
    )
    if (hlsStream?.url) hls = hlsStream.url
  }
  return {
    ...payload,
    hls,
    videoStreams,
    audioStreams,
  }
}

/** True when at least one stream is likely to work in-browser (score threshold). */
export function hasBrowserPlayableSources(payload) {
  return browserPlayScore(payload) >= 40
}
