import type {
  ChannelResponse,
  CommentsResponse,
  SearchResponse,
  StreamItem,
  VideoStreamsResponse,
} from './types'
import {
  filterCatalogVideos,
  isLiveCatalogItem,
  normalizeCatalogPayload,
  orderCatalogVodFirst,
  type CatalogItem,
} from './catalog'

const PROXY = '/api/proxy'
const API_BASE_KEY = 'tubepwa.apiBase'

export type { CatalogItem }
export {
  filterCatalogVideos,
  normalizeCatalogPayload,
  orderCatalogVodFirst,
  isLiveCatalogItem,
  catalogVideoId,
  partitionLive,
} from './catalog'

export function getSavedApiBase(): string {
  try {
    return localStorage.getItem(API_BASE_KEY) || ''
  } catch {
    return ''
  }
}

export function setSavedApiBase(url: string) {
  try {
    if (!url) localStorage.removeItem(API_BASE_KEY)
    else localStorage.setItem(API_BASE_KEY, url.replace(/\/$/, ''))
  } catch {
    /* ignore */
  }
}

async function api<T>(path: string): Promise<T> {
  const qs = new URLSearchParams({ path })
  const base = getSavedApiBase()
  if (base) qs.set('base', base)

  const res = await fetch(`${PROXY}?${qs}`, {
    headers: { Accept: 'application/json' },
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok || (data && typeof data === 'object' && 'error' in data && data.error)) {
    throw new Error(
      (data && typeof data === 'object' && data.error) || `HTTP ${res.status}`,
    )
  }
  return data
}

export async function getTrending(region = 'US'): Promise<StreamItem[]> {
  const raw = await api<StreamItem[] | unknown>(
    `/trending?region=${encodeURIComponent(region)}`,
  )
  return orderCatalogVodFirst(normalizeCatalogPayload(raw)) as StreamItem[]
}

/**
 * Search videos. filter: all | videos | music_videos | ...
 * Results are normalized so non-stream types with a video id are kept.
 */
export async function searchVideos(
  q: string,
  nextpage?: string | null,
  filter: string = 'videos',
): Promise<SearchResponse> {
  let res: SearchResponse
  if (nextpage) {
    res = await api<SearchResponse>(
      `/nextpage/search?nextpage=${encodeURIComponent(nextpage)}&q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`,
    )
  } else {
    res = await api<SearchResponse>(
      `/search?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}`,
    )
  }
  const items = filterCatalogVideos(res.items || []) as StreamItem[]
  return { items, nextpage: res.nextpage }
}

/** Home browse: not live-only — supplement trending when feed is all-live. */
export async function getBrowseFeed(
  mode: 'trending' | 'videos' | 'music',
  region = 'US',
): Promise<StreamItem[]> {
  if (mode === 'music') {
    const r = await searchVideos('music', null, 'music_videos')
    return orderCatalogVodFirst(r.items)
  }
  if (mode === 'videos') {
    // Broad ordinary VOD catalog (not popularity/live streams only)
    const queries = ['official music video', 'documentary', 'tutorial']
    const batches = await Promise.all(
      queries.map((q) => searchVideos(q, null, 'videos').catch(() => ({ items: [], nextpage: null }))),
    )
    const merged = filterCatalogVideos(batches.flatMap((b) => b.items)) as StreamItem[]
    return orderCatalogVodFirst(merged)
  }

  // trending: VOD-first; if YouTube trending is all-live, merge video search
  const trending = await getTrending(region)
  const vods = trending.filter((i) => !isLiveCatalogItem(i as CatalogItem) && (i.duration ?? 0) > 0)
  if (vods.length >= 8) return orderCatalogVodFirst(trending)

  try {
    const extra = await searchVideos('official video', null, 'videos')
    const merged = filterCatalogVideos([
      ...vods,
      ...extra.items,
      ...trending,
    ] as CatalogItem[]) as StreamItem[]
    return orderCatalogVodFirst(merged)
  } catch {
    return orderCatalogVodFirst(trending)
  }
}

export async function getSuggestions(q: string) {
  if (!q.trim()) return [] as string[]
  return api<string[]>(`/suggestions?query=${encodeURIComponent(q)}`)
}

export async function getStreams(id: string) {
  return api<VideoStreamsResponse>(`/streams/${encodeURIComponent(id)}`)
}

export async function getComments(id: string, nextpage?: string | null) {
  if (nextpage) {
    return api<CommentsResponse>(
      `/nextpage/comments/${encodeURIComponent(id)}?nextpage=${encodeURIComponent(nextpage)}`,
    )
  }
  return api<CommentsResponse>(`/comments/${encodeURIComponent(id)}`)
}

export async function getChannel(id: string) {
  return api<ChannelResponse>(`/channel/${encodeURIComponent(id)}`)
}

export async function getChannelNext(id: string, nextpage: string) {
  return api<{ nextpage: string | null; relatedStreams: StreamItem[] }>(
    `/nextpage/channel/${encodeURIComponent(id)}?nextpage=${encodeURIComponent(nextpage)}`,
  )
}

/** Parse video id from bare id or any common YouTube URL / shared text. */
export function extractVideoId(urlOrText: string): string | null {
  if (!urlOrText) return null
  const s = urlOrText.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
    /youtube\.com\/watch\/([\w-]{11})/,
  ]
  for (const re of patterns) {
    const m = s.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

export function extractChannelId(url: string): string | null {
  if (!url) return null
  if (url.startsWith('UC') && url.length >= 20) return url
  const m = url.match(/\/channel\/([^/?#]+)/)
  return m ? m[1] : url.replace(/^\//, '') || null
}
