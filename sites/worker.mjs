import { isAllowedMediaUrl } from '../server/media-proxy.mjs'
import { handleProxy } from '../server/proxy-core.mjs'

const MAX_MEDIA_BYTES = 256 * 1024 * 1024
const MAX_REDIRECTS = 3
const MEDIA_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

function preflight(methods) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Range, Accept',
      'Access-Control-Max-Age': '86400',
    },
  })
}

async function handleCatalogRequest(request, url) {
  if (request.method === 'OPTIONS') return preflight('GET,OPTIONS')
  if (request.method !== 'GET') {
    return json(405, { error: 'Catalog requests must use GET', code: 'BAD_METHOD' }, { Allow: 'GET' })
  }

  const result = await handleProxy(
    url.searchParams.get('path') || '',
    url.searchParams.get('base') || '',
  )
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  })
}

function mediaHeaders(request) {
  const headers = new Headers({
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Origin: 'https://www.youtube.com',
    Referer: 'https://www.youtube.com/',
    'User-Agent': MEDIA_USER_AGENT,
  })
  const range = request.headers.get('range')
  if (range) headers.set('Range', range)
  return headers
}

async function safeMediaFetch(target, request, redirectsLeft = MAX_REDIRECTS) {
  if (!isAllowedMediaUrl(target)) throw new Error('media URL not allowed')
  const response = await fetch(target, {
    method: 'GET',
    headers: mediaHeaders(request),
    redirect: 'manual',
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location || redirectsLeft <= 0) throw new Error('unsafe media redirect')
    const next = new URL(location, target).toString()
    if (!isAllowedMediaUrl(next)) throw new Error('redirect target not allowed')
    return safeMediaFetch(next, request, redirectsLeft - 1)
  }
  return response
}

function validateMediaResponse(response) {
  const length = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(length) && length > MAX_MEDIA_BYTES) {
    throw new Error('media exceeds proxy size limit')
  }

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

async function handleMediaRequest(request, url) {
  if (request.method === 'OPTIONS') return preflight('GET,OPTIONS')
  if (request.method !== 'GET' || request.headers.get('sec-fetch-dest') === 'document') {
    return json(405, { error: 'Media requests must use GET', code: 'BAD_METHOD' }, { Allow: 'GET' })
  }

  const target = url.searchParams.get('url') || ''
  if (!isAllowedMediaUrl(target)) {
    return json(400, { error: 'URL not allowed', code: 'BAD_MEDIA_URL' })
  }

  try {
    const upstream = await safeMediaFetch(target, request)
    validateMediaResponse(upstream)

    const headers = new Headers()
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ]) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
    headers.set('Cache-Control', 'private, max-age=120')
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
    headers.set('X-Content-Type-Options', 'nosniff')

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (error) {
    return json(502, {
      error: error instanceof Error ? error.message : 'media proxy failed',
      code: 'MEDIA_PROXY_FAIL',
    })
  }
}

async function serveApp(request, env) {
  const response = await env.ASSETS.fetch(request)
  if (response.status !== 404 || request.method !== 'GET') return response

  const acceptsHtml = (request.headers.get('accept') || '').includes('text/html')
  if (!acceptsHtml) return response

  const indexUrl = new URL('/index.html', request.url)
  return env.ASSETS.fetch(
    new Request(indexUrl, {
      method: 'GET',
      headers: request.headers,
    }),
  )
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/proxy') return handleCatalogRequest(request, url)
    if (url.pathname === '/api/media') return handleMediaRequest(request, url)
    return serveApp(request, env)
  },
}

export default worker
