/**
 * Injected into the PWA service worker (workbox importScripts).
 * Proxies media from the *browser* IP so googlevideo Range/full GETs work
 * and the page can MSE-fetch with CORS (direct fetch is blocked).
 */
/* eslint-disable no-restricted-globals */
self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url)
    if (url.pathname !== '/__tube_media') return

    const target = url.searchParams.get('url')
    if (!target) {
      event.respondWith(
        new Response(JSON.stringify({ error: 'missing url' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      return
    }

    let dest
    try {
      dest = new URL(target)
    } catch {
      event.respondWith(new Response('bad url', { status: 400 }))
      return
    }

    const host = dest.hostname
    const allowed =
      /\.googlevideo\.com$/i.test(host) ||
      host === 'googlevideo.com' ||
      /\.googleusercontent\.com$/i.test(host) ||
      /\.ytimg\.com$/i.test(host) ||
      /\.ggpht\.com$/i.test(host) ||
      /\.odycdn\.com$/i.test(host) ||
      /piped/i.test(host) ||
      /invidious/i.test(host) ||
      host === 'yewtu.be'

    if (dest.protocol !== 'https:' || !allowed) {
      event.respondWith(new Response('host not allowed', { status: 403 }))
      return
    }

    event.respondWith(proxyMedia(event.request, dest.toString()))
  } catch {
    /* ignore — fall through to other handlers */
  }
})

async function proxyMedia(request, target) {
  const headers = new Headers()
  headers.set(
    'User-Agent',
    request.headers.get('User-Agent') ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  )
  headers.set('Accept', '*/*')
  headers.set('Referer', 'https://www.youtube.com/')
  headers.set('Origin', 'https://www.youtube.com')
  const range = request.headers.get('Range')
  if (range) headers.set('Range', range)

  const upstream = await fetch(target, {
    method: 'GET',
    headers,
    credentials: 'omit',
    mode: 'cors',
    redirect: 'follow',
  }).catch(async () => {
    // googlevideo often has no ACAO — no-cors is useless for body; retry as
    // opaque fails. Use plain fetch without mode (same as navigation).
    return fetch(target, { method: 'GET', headers, redirect: 'follow' })
  })

  // Rebuild response with CORS so page MSE/fetch can read the body
  const outHeaders = new Headers()
  const pass = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
  ]
  for (const h of pass) {
    const v = upstream.headers.get(h)
    if (v) outHeaders.set(h, v)
  }
  outHeaders.set('Access-Control-Allow-Origin', self.location.origin)
  outHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
  outHeaders.set('Cache-Control', 'private, max-age=120')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
