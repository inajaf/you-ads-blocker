/**
 * Pure catalog helpers — keep list logic separate from network/stream resolve.
 * Used by Home/Search and unit-tested offline.
 */

export interface CatalogItem {
  url: string
  type?: string
  title: string
  thumbnail: string
  uploaderName: string
  uploaderUrl?: string
  uploaderAvatar?: string
  uploadedDate?: string
  duration: number
  views: number
  uploaderVerified?: boolean
  isShort?: boolean
}

const NON_VIDEO_TYPES = new Set([
  'channel',
  'playlist',
  'music_artist',
  'music_album',
  'music_playlist',
  'hashtag',
  'movie', // keep? movies can be playable — allow if url has watch
])

/** True when item is a live broadcast (Piped uses duration -1). */
export function isLiveCatalogItem(item: CatalogItem): boolean {
  if (item.duration === -1) return true
  const t = (item.type || '').toLowerCase()
  return t === 'livestream' || t === 'live'
}

/** Extract 11-char video id from Piped-style url/path if present. */
export function catalogVideoId(item: CatalogItem): string | null {
  const u = item.url || ''
  if (/^[\w-]{11}$/.test(u)) return u
  const m =
    u.match(/[?&]v=([\w-]{11})/) ||
    u.match(/\/shorts\/([\w-]{11})/) ||
    u.match(/\/embed\/([\w-]{11})/) ||
    u.match(/youtu\.be\/([\w-]{11})/)
  return m ? m[1] : null
}

/**
 * Keep playable catalog rows: normal VODs, shorts, music videos, etc.
 * Drop pure channels/playlists without a video id.
 * Do NOT require type === "stream" only.
 */
export function filterCatalogVideos(
  items: CatalogItem[] | null | undefined,
): CatalogItem[] {
  if (!Array.isArray(items)) return []
  const out: CatalogItem[] = []
  const seen = new Set<string>()

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as CatalogItem
    const type = (item.type || '').toLowerCase()

    // Explicit non-video rows without watch url
    if (NON_VIDEO_TYPES.has(type) && !catalogVideoId(item) && !item.url?.includes('watch')) {
      continue
    }

    // Channel-only rows often have type channel
    if (type === 'channel' || type === 'playlist') {
      if (!catalogVideoId(item)) continue
    }

    const id = catalogVideoId(item)
    // Must have a resolvable video id OR a watch URL we can parse later
    if (!id && !/watch|shorts|youtu\.be/i.test(item.url || '')) {
      // Some Piped "stream" items always have /watch?v=
      if (type && type !== 'stream' && type !== 'video' && type !== 'short' && type !== 'music_video') {
        continue
      }
      if (!item.url) continue
    }

    const key = id || item.url
    if (!key || seen.has(key)) continue
    seen.add(key)

    out.push({
      ...item,
      title: item.title || 'Untitled',
      thumbnail: item.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
      uploaderName: item.uploaderName || '',
      duration: typeof item.duration === 'number' ? item.duration : 0,
      views: typeof item.views === 'number' ? item.views : 0,
    })
  }
  return out
}

/**
 * Prefer ordinary VODs (positive duration) over live (-1) and zero-duration unknowns.
 * Does not drop live — only reorders so home isn't a live-only feel.
 */
export function orderCatalogVodFirst(items: CatalogItem[]): CatalogItem[] {
  const score = (i: CatalogItem) => {
    if (isLiveCatalogItem(i)) return 2
    if (i.duration > 0) return 0
    return 1
  }
  return [...items].sort((a, b) => score(a) - score(b))
}

/** Split for UI badges / optional live tab. */
export function partitionLive(
  items: CatalogItem[],
): { vod: CatalogItem[]; live: CatalogItem[] } {
  const vod: CatalogItem[] = []
  const live: CatalogItem[] = []
  for (const i of items) {
    if (isLiveCatalogItem(i)) live.push(i)
    else vod.push(i)
  }
  return { vod, live }
}

/**
 * Normalize search/trending API payloads into a video list.
 * Accepts bare array (trending) or { items } (search).
 */
export function normalizeCatalogPayload(data: unknown): CatalogItem[] {
  if (Array.isArray(data)) return filterCatalogVideos(data as CatalogItem[])
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return filterCatalogVideos((data as { items: CatalogItem[] }).items)
  }
  return []
}
