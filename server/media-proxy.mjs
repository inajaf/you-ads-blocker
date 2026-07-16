/**
 * Same-origin media proxy so the browser can MSE-fetch googlevideo.
 * Adaptive streams often 403 on bare GET — assemble via sequential Range chunks.
 */

const ALLOWED_MEDIA_SUFFIXES = [
  'googlevideo.com',
  'googleusercontent.com',
  'ytimg.com',
  'ggpht.com',
  'odycdn.com',
  'lbry.tv',
]

const ALLOWED_MEDIA_ORIGINS = new Set([
  'https://proxy.piped.private.coffee',
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
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.flokinet.to',
  'https://vid.puffyan.us',
  'https://invidious.protokolla.fi',
  'https://iv.ggtyler.dev',
  'https://invidious.materialio.us',
  'https://invidious.slipfox.xyz',
  'https://inv.tux.pizza',
])

const MAX_MEDIA_BYTES = 256 * 1024 * 1024
const MAX_REDIRECTS = 3

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    if (u.username || u.password || (u.port && u.port !== '443')) return false
    const host = u.hostname.toLowerCase()
    if (!host || host === 'localhost' || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':')) {
      return false
    }
    return (
      ALLOWED_MEDIA_ORIGINS.has(u.origin) ||
      ALLOWED_MEDIA_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
      )
    )
  } catch {
    return false
  }
}

async function safeMediaFetch(targetUrl, init = {}, redirectsLeft = MAX_REDIRECTS) {
  if (!isAllowedMediaUrl(targetUrl)) throw new Error('media URL not allowed')
  const response = await fetch(targetUrl, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location || redirectsLeft <= 0) throw new Error('unsafe media redirect')
    const next = new URL(location, targetUrl).toString()
    if (!isAllowedMediaUrl(next)) throw new Error('redirect target not allowed')
    return safeMediaFetch(next, init, redirectsLeft - 1)
  }
  return response
}

function checkedLength(response, fallback = 0) {
  const value = Number(response.headers.get('content-length') || fallback)
  if (Number.isFinite(value) && value > MAX_MEDIA_BYTES) {
    throw new Error('media exceeds proxy size limit')
  }
  return value
}

function assertMediaResponse(response) {
  checkedLength(response)
  const type = (response.headers.get('content-type') || 'application/octet-stream')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
  const allowed =
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    type === 'application/octet-stream' ||
    type === 'application/vnd.apple.mpegurl' ||
    type === 'application/x-mpegurl'
  if (!allowed) throw new Error(`upstream is not media (${type || 'unknown'})`)
}

function setSafeMediaHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
}

function baseHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com',
    'Accept-Encoding': 'identity',
    ...extra,
  }
}

/**
 * Download entire media via sequential Range requests (googlevideo-friendly).
 */
async function downloadViaRanges(targetUrl, signal) {
  const probe = await safeMediaFetch(targetUrl, {
    headers: baseHeaders({ Range: 'bytes=0-0' }),
    signal,
  })
  if (probe.status === 200) {
    assertMediaResponse(probe)
    return {
      status: 200,
      buf: Buffer.from(await probe.arrayBuffer()),
      contentType: probe.headers.get('content-type') || 'application/octet-stream',
    }
  }
  if (probe.status !== 206) {
    throw new Error(`probe ${probe.status}`)
  }
  const cr = probe.headers.get('content-range') || ''
  const total = Number(cr.split('/')[1])
  if (!Number.isFinite(total) || total <= 0) throw new Error('no total size')
  if (total > MAX_MEDIA_BYTES) throw new Error('media exceeds proxy size limit')

  const CHUNK = 64 * 1024
  const parts = []
  let offset = 0
  let fails = 0
  while (offset < total) {
    if (signal?.aborted) throw new Error('aborted')
    const end = Math.min(offset + CHUNK - 1, total - 1)
    const r = await safeMediaFetch(targetUrl, {
      headers: baseHeaders({ Range: `bytes=${offset}-${end}` }),
      signal,
    })
    if (!r.ok) {
      fails++
      if (fails > 8) throw new Error(`range ${offset} HTTP ${r.status}`)
      await new Promise((x) => setTimeout(x, 120 * fails))
      continue
    }
    fails = 0
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) throw new Error(`empty range at ${offset}`)
    parts.push(buf)
    offset += buf.length
  }
  return {
    status: 200,
    buf: Buffer.concat(parts),
    contentType: probe.headers.get('content-type') || 'application/octet-stream',
  }
}

/**
 * Node http handler: proxy media with Range support.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} targetUrl
 */
export async function proxyMediaRequest(req, res, targetUrl) {
  setSafeMediaHeaders(res)
  if (req.method !== 'GET' || req.headers['sec-fetch-dest'] === 'document') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Media requests must use GET', code: 'BAD_METHOD' }))
    return
  }
  if (!isAllowedMediaUrl(targetUrl)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'URL not allowed', code: 'BAD_MEDIA_URL' }))
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180000)
  req.on('close', () => {
    try {
      controller.abort()
    } catch {
      /* ignore */
    }
  })

  try {
    const clientRange = req.headers.range

    // Pass-through Range (client/MSE chunked download)
    if (clientRange) {
      const upstream = await safeMediaFetch(targetUrl, {
        headers: baseHeaders({ Range: clientRange }),
        signal: controller.signal,
      })
      assertMediaResponse(upstream)
      res.statusCode = upstream.status
      for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ]) {
        const v = upstream.headers.get(h)
        if (v) res.setHeader(h, v)
      }
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges',
      )
      res.setHeader('Cache-Control', 'private, max-age=120')
      if (!upstream.body) {
        res.end()
        return
      }
      const reader = upstream.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!res.write(Buffer.from(value))) {
          await new Promise((r) => res.once('drain', r))
        }
      }
      res.end()
      return
    }

    // Full body: stream a direct media response without buffering it in Node.
    try {
      const upstream = await safeMediaFetch(targetUrl, {
        headers: baseHeaders(),
        signal: controller.signal,
      })
      if (upstream.ok && upstream.body) {
        assertMediaResponse(upstream)
        res.statusCode = upstream.status
        for (const h of ['content-type', 'content-length', 'accept-ranges']) {
          const value = upstream.headers.get(h)
          if (value) res.setHeader(h, value)
        }
        res.setHeader('Cache-Control', 'private, max-age=120')
        const reader = upstream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!res.write(Buffer.from(value))) {
            await new Promise((resolve) => res.once('drain', resolve))
          }
        }
        res.end()
        return
      }
    } catch {
      /* retry as bounded sequential ranges below */
    }

    const result = await downloadViaRanges(targetUrl, controller.signal)

    res.statusCode = result.status
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Content-Length', String(result.buf.length))
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges',
    )
    res.setHeader('Cache-Control', 'private, max-age=120')
    res.end(result.buf)
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: e instanceof Error ? e.message : 'media proxy failed',
          code: 'MEDIA_PROXY_FAIL',
        }),
      )
    } else {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Netlify handler (buffered). */
export async function handleMediaProxy(targetUrl, requestHeaders = {}) {
  if (!isAllowedMediaUrl(targetUrl)) {
    return {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
      body: JSON.stringify({ error: 'URL not allowed', code: 'BAD_MEDIA_URL' }),
    }
  }

  const range = requestHeaders.range || requestHeaders.Range
  try {
    if (range) {
      const upstream = await safeMediaFetch(targetUrl, {
        headers: baseHeaders({ Range: range }),
      })
      assertMediaResponse(upstream)
      const buf = Buffer.from(await upstream.arrayBuffer())
      const headers = {
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'private, max-age=120',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      }
      for (const h of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ]) {
        const v = upstream.headers.get(h)
        if (v) headers[h] = v
      }
      return { status: upstream.status, headers, body: buf }
    }

    let result
    try {
      const upstream = await safeMediaFetch(targetUrl, {
        headers: baseHeaders(),
      })
      if (upstream.ok) {
        assertMediaResponse(upstream)
        result = {
          status: 200,
          buf: Buffer.from(await upstream.arrayBuffer()),
          contentType: upstream.headers.get('content-type') || 'application/octet-stream',
        }
      } else {
        result = await downloadViaRanges(targetUrl)
      }
    } catch {
      result = await downloadViaRanges(targetUrl)
    }

    return {
      status: result.status,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.buf.length),
        'Accept-Ranges': 'bytes',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'private, max-age=120',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
      body: result.buf,
    }
  } catch (e) {
    return {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
      body: JSON.stringify({
        error: e instanceof Error ? e.message : 'media proxy failed',
        code: 'MEDIA_PROXY_FAIL',
      }),
    }
  }
}
