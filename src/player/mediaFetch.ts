/**
 * Fetch media for MSE.
 * Prefer same-origin /api/media (CORS-safe). Then SW, then direct.
 */

export function mediaProxyUrl(absolute: string): string {
  return `/__tube_media?url=${encodeURIComponent(absolute)}`
}

export function serverMediaProxyUrl(absolute: string): string {
  return `/api/media?url=${encodeURIComponent(absolute)}`
}

type ProxyFn = (u: string) => string

const identity: ProxyFn = (u) => u

async function fetchOnce(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'omit', mode: 'cors' })
}

export async function fetchMediaBuffer(
  absolute: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  // Server proxy first (same-origin). Direct needs CORS extension.
  const strategies: ProxyFn[] = [serverMediaProxyUrl, mediaProxyUrl, identity]
  let lastErr: unknown

  for (const toUrl of strategies) {
    try {
      return await fetchMediaBufferVia(toUrl, absolute, signal)
    } catch (e) {
      lastErr = e
      if (signal?.aborted) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('media fetch failed')
}

async function fetchMediaBufferVia(
  toUrl: ProxyFn,
  absolute: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const target = toUrl(absolute)

  const probe = await fetchOnce(target, {
    headers: { Range: 'bytes=0-0' },
    signal,
  })

  if (probe.status === 200) {
    return probe.arrayBuffer()
  }

  if (probe.status !== 206) {
    const full = await fetchOnce(target, { signal })
    if (!full.ok) throw new Error(`media ${full.status}`)
    return full.arrayBuffer()
  }

  const cr = probe.headers.get('content-range') || ''
  const total = Number(cr.split('/')[1])
  if (!Number.isFinite(total) || total <= 0) {
    const full = await fetchOnce(target, { signal })
    if (!full.ok) throw new Error(`media ${full.status}`)
    return full.arrayBuffer()
  }

  // Cap very large downloads for auto-switch (avoid multi-minute hang).
  // Manual 1080 still tries full file; caller has timeout.
  const CHUNK = 256 * 1024
  const parts: Uint8Array[] = []
  let offset = 0

  while (offset < total) {
    if (signal?.aborted) throw new Error('aborted')
    const end = Math.min(offset + CHUNK - 1, total - 1)
    let buf: ArrayBuffer | null = null
    for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
      const res = await fetchOnce(target, {
        headers: { Range: `bytes=${offset}-${end}` },
        signal,
      })
      if (res.ok || res.status === 206) {
        buf = await res.arrayBuffer()
        break
      }
      await new Promise((r) => setTimeout(r, 100 * attempt))
    }
    if (!buf || buf.byteLength === 0) {
      throw new Error(`range fail at ${offset}/${total}`)
    }
    parts.push(new Uint8Array(buf))
    offset += buf.byteLength
  }

  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.byteLength
  }
  return out.buffer
}
