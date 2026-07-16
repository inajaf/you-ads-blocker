import { fetchYouTubeStreams, videoIdFromStreamsPath } from './innertube.mjs'
import { fetchInvidiousStreams } from './invidious.mjs'
import {
  browserPlayScore,
  hasBrowserPlayableSources,
  hasPlayableSources,
  rankStreamsForBrowser,
} from './stream-map.mjs'

export const DEFAULT_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.darkness.services',
  'https://pipedapi.ducks.party',
  'https://pipedapi.smnz.de',
  'https://pipedapi.privacyredirect.com',
  'https://pipedapi.drgns.space',
  'https://pipedapi.reallyaweso.me',
]

/** Strong enough to return without waiting remaining backends. */
const FAST_SCORE = 100

/**
 * Prefer direct extractors over public proxies. InnerTube (the NewPipe/Brave
 * approach) returns fresh googlevideo URLs with a full adaptive ladder + audio;
 * Invidious often returns direct googlevideo too; Piped proxies are the last
 * resort (frequently 360p-only or dead LBRY/odycdn fallbacks). This dominates
 * the raw play-score, which over-rewards Piped's proxied /videoplayback URLs.
 */
function sourceRank(source) {
  const s = String(source || '')
  if (s.startsWith('innertube')) return 3
  if (s.startsWith('invidious')) return 2
  return 1
}
const ALLOWED_API_ORIGINS = new Set(DEFAULT_INSTANCES.map((base) => new URL(base).origin))
const ALLOWED_API_PATHS = [
  /^\/trending(?:\?|$)/,
  /^\/search(?:\?|$)/,
  /^\/suggestions(?:\?|$)/,
  /^\/streams\/[\w-]{11}(?:\?|$)/,
  /^\/comments\/[\w-]{11}(?:\?|$)/,
  /^\/nextpage\/comments\/[\w-]{11}(?:\?|$)/,
  /^\/channel\/[\w-]{1,128}(?:\?|$)/,
  /^\/nextpage\/channel\/[\w-]{1,128}(?:\?|$)/,
  /^\/nextpage\/search(?:\?|$)/,
]

function isAllowedBase(base) {
  try {
    const u = new URL(base)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      (u.pathname === '/' || u.pathname === '') &&
      !u.search &&
      !u.hash &&
      ALLOWED_API_ORIGINS.has(u.origin)
    )
  } catch {
    return false
  }
}

async function fetchPiped(base, path, signal, redirectsLeft = 2) {
  const target = new URL(path, `${base.replace(/\/$/, '')}/`)
  if (!ALLOWED_API_ORIGINS.has(target.origin)) throw new Error('API origin not allowed')
  const res = await fetch(target, {
    signal,
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TubePWA-Proxy/1.4',
    },
  })
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    if (!location || redirectsLeft <= 0) throw new Error('unsafe API redirect')
    const next = new URL(location, target)
    if (!ALLOWED_API_ORIGINS.has(next.origin)) throw new Error('redirect origin not allowed')
    return fetchPiped(next.origin, `${next.pathname}${next.search}`, signal, redirectsLeft - 1)
  }
  return res
}

async function racePiped(bases, path) {
  // Hedge two trusted instances at a time and cancel the slower peer once one
  // succeeds. This avoids leaking every request to all configured operators.
  for (let index = 0; index < bases.length; index += 2) {
    const group = bases.slice(index, index + 2)
    const controllers = group.map(() => new AbortController())
    const tasks = group.map(async (base, taskIndex) => {
      const controller = controllers[taskIndex]
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetchPiped(base, path, controller.signal)
        const text = await res.text()
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const parsed = JSON.parse(text)
        if (parsed?.error) throw new Error(String(parsed.error))
        if (path.startsWith('/streams/') && !hasPlayableSources(parsed)) {
          throw new Error('empty streams')
        }
        if (path.startsWith('/trending') && Array.isArray(parsed) && parsed.length === 0) {
          throw new Error('empty trending')
        }
        return { base, text, parsed }
      } finally {
        clearTimeout(timer)
      }
    })
    try {
      const winner = await Promise.any(tasks)
      controllers.forEach((controller) => controller.abort())
      return winner
    } catch {
      controllers.forEach((controller) => controller.abort())
    }
  }
  return null
}

function okBody(payload, source, extraHeaders = {}) {
  const ranked = rankStreamsForBrowser(payload)
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Stream-Source': source,
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
    body: JSON.stringify(ranked),
  }
}

function toCandidate(payload, source, base = null) {
  if (!payload) return null
  const ranked = rankStreamsForBrowser(payload)
  if (!hasPlayableSources(ranked)) return null
  return {
    payload: ranked,
    score: browserPlayScore(ranked),
    source: ranked._source || source,
    base,
  }
}

/**
 * Collect candidates as backends finish; return early on strong score.
 */
async function resolveStreams(videoId, bases) {
  const path = `/streams/${videoId}`
  const candidates = []

  const add = (c) => {
    if (c) candidates.push(c)
  }

  let resolveFirstStrong
  const firstStrong = new Promise((resolve) => {
    resolveFirstStrong = resolve
  })

  const tryAdd = (c) => {
    add(c)
    // Only short-circuit on a strong *direct* extractor. A strong Piped score is
    // usually an inflated proxied-URL score hiding a 360p-only result, so let the
    // direct backends finish before settling for it.
    if (c && c.score >= FAST_SCORE && sourceRank(c.source) >= 2) resolveFirstStrong(c)
  }

  const innertubeJob = fetchYouTubeStreams(videoId, { deadlineMs: 12000 })
    .then((r) => {
      tryAdd(toCandidate(r, r?._source || 'innertube'))
      return r
    })
    .catch(() => null)

  const pipedJob = racePiped(bases, path)
    .then((r) => {
      if (!r?.parsed) return null
      const c = toCandidate(r.parsed, 'piped', r.base)
      tryAdd(c)
      return r
    })
    .catch(() => null)

  const invJob = fetchInvidiousStreams(videoId)
    .then((r) => {
      tryAdd(toCandidate(r, 'invidious'))
      return r
    })
    .catch(() => null)

  const allDone = Promise.all([innertubeJob, pipedJob, invJob])

  // Wait for first strong candidate OR all backends finished (max ~16s wall)
  await Promise.race([
    firstStrong,
    allDone,
    new Promise((r) => setTimeout(r, 16000)),
  ])

  // If we already have a strong winner, don't block; otherwise wait briefly for stragglers
  const bestNow = () => {
    candidates.sort(
      (a, b) => sourceRank(b.source) - sourceRank(a.source) || b.score - a.score,
    )
    return candidates.find((c) => c.score >= 40) || candidates[0] || null
  }

  let winner = bestNow()
  if (!winner || winner.score < FAST_SCORE) {
    await Promise.race([allDone, new Promise((r) => setTimeout(r, 4000))])
    winner = bestNow()
  }

  if (!winner || !hasPlayableSources(winner.payload)) {
    return null
  }

  // Optional related/subtitles from Piped — never block the response on slow Piped
  const pipedRes = await Promise.race([
    pipedJob,
    new Promise((r) => setTimeout(() => r(null), 250)),
  ])
  const pipedRelated = pipedRes?.parsed?.relatedStreams
  if (
    pipedRelated?.length &&
    (!winner.payload.relatedStreams || winner.payload.relatedStreams.length === 0)
  ) {
    winner.payload = {
      ...winner.payload,
      relatedStreams: pipedRelated,
    }
  }
  if (
    pipedRes?.parsed?.subtitles?.length &&
    (!winner.payload.subtitles || !winner.payload.subtitles.length)
  ) {
    winner.payload = {
      ...winner.payload,
      subtitles: pipedRes.parsed.subtitles,
    }
  }

  const headers = {}
  if (winner.base) headers['X-Piped-Instance'] = winner.base
  headers['X-Play-Score'] = String(winner.score)

  return okBody(winner.payload, winner.source, headers)
}

/**
 * Shared handler for Vite middleware and Netlify function.
 * @returns {{ status: number, headers: Record<string,string>, body: string }}
 */
export async function handleProxy(path, preferredBase = '') {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return json(400, { error: 'Invalid path', code: 'BAD_PATH' })
  }
  if (!ALLOWED_API_PATHS.some((pattern) => pattern.test(path))) {
    return json(400, { error: 'Unsupported API path', code: 'BAD_PATH' })
  }

  const bases = [
    ...(preferredBase && isAllowedBase(preferredBase)
      ? [preferredBase.replace(/\/$/, '')]
      : []),
    ...DEFAULT_INSTANCES,
  ].filter((v, i, a) => a.indexOf(v) === i)

  const videoId = videoIdFromStreamsPath(path)
  if (videoId) {
    const resolved = await resolveStreams(videoId, bases)
    if (resolved) return resolved
    return json(502, {
      error:
        'Could not get browser-playable media for this video. It may be live, region-restricted, or blocked on public extractors. Try another video or later.',
      code: 'STREAMS_UNAVAILABLE',
      videoId,
    })
  }

  const piped = await racePiped(bases, path)
  if (piped) {
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Piped-Instance': piped.base,
        'X-Stream-Source': 'piped',
        'X-Content-Type-Options': 'nosniff',
      },
      body: piped.text,
    }
  }

  return json(502, {
    error: 'All backends failed for this request. Public extractors may be down — try later.',
    code: 'BACKENDS_DOWN',
  })
}

function json(status, obj) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(obj),
  }
}

// re-export for tests
export { hasBrowserPlayableSources, isAllowedBase as isAllowedApiBase }
