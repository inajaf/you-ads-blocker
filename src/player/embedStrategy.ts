/**
 * Pure YouTube embed strategy — unit-tested offline.
 * Keeps localhost/http from forcing broken origin params.
 */

export type EmbedHost = 'youtube' | 'nocookie'

/** YT IFrame API error codes that mean in-app embed cannot play this video. */
export const YT_EMBED_BLOCKED_CODES = new Set([100, 101, 150])

/** Config / host issues worth one host retry before stream fallback. */
export const YT_HOST_RETRY_CODES = new Set([153, 5])

export function isHttpsPage(protocol: string): boolean {
  return protocol === 'https:'
}

/**
 * Build embed URL. Never attaches `origin=` on non-https (localhost http
 * is a common cause of “Video unavailable”).
 */
export function buildEmbedUrl(
  videoId: string,
  opts: {
    host?: EmbedHost
    startSec?: number
    enableJsApi?: boolean
    pageProtocol?: string
    pageOrigin?: string
  } = {},
): string {
  const host = opts.host || 'youtube'
  const base =
    host === 'nocookie'
      ? 'https://www.youtube-nocookie.com/embed/'
      : 'https://www.youtube.com/embed/'
  const q = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    fs: '1',
    controls: '1',
  })
  const start = Math.max(0, Math.floor(opts.startSec || 0))
  if (start > 0) q.set('start', String(start))
  if (opts.enableJsApi) {
    q.set('enablejsapi', '1')
    if (
      opts.pageProtocol &&
      isHttpsPage(opts.pageProtocol) &&
      opts.pageOrigin
    ) {
      q.set('origin', opts.pageOrigin)
    }
  }
  return `${base}${encodeURIComponent(videoId)}?${q.toString()}`
}

/**
 * After a YT onError, decide next action.
 * - retry_host: flip to other embed host once
 * - stream_fallback: embed cannot play → in-app stream player
 */
export function nextEmbedAction(
  code: number,
  currentHost: EmbedHost,
  alreadyRetriedHost: boolean,
): { action: 'retry_host'; host: EmbedHost } | { action: 'stream_fallback'; reason: string } {
  const reason =
    code === 100
      ? 'Video not found'
      : code === 101 || code === 150
        ? 'Embedding disabled for this video'
        : code === 153
          ? 'Player configuration error'
          : `YouTube error ${code}`

  // Not found → stream immediately (host flip won't help)
  if (code === 100) {
    return { action: 'stream_fallback', reason }
  }

  // One host flip for config/embed-disabled quirks
  if (!alreadyRetriedHost && (YT_HOST_RETRY_CODES.has(code) || code === 101 || code === 150)) {
    const other: EmbedHost = currentHost === 'youtube' ? 'nocookie' : 'youtube'
    return { action: 'retry_host', host: other }
  }

  return { action: 'stream_fallback', reason }
}

/** PlayerVars for YT.Player — omit origin on non-https. */
export function buildPlayerVars(
  startSec: number,
  pageProtocol: string,
  pageOrigin: string,
): Record<string, string | number> {
  const start = Math.max(0, Math.floor(startSec || 0))
  const vars: Record<string, string | number> = {
    autoplay: 1,
    playsinline: 1,
    rel: 0,
    modestbranding: 1,
    iv_load_policy: 3,
    controls: 1,
    fs: 1,
  }
  if (start > 0) vars.start = start
  if (isHttpsPage(pageProtocol) && pageOrigin) {
    vars.origin = pageOrigin
  }
  return vars
}
