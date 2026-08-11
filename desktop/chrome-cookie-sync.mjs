import net from 'node:net'

const AUTH_COOKIE_NAMES = new Set([
  'APISID',
  'HSID',
  'LOGIN_INFO',
  'SAPISID',
  'SID',
  'SSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
])

const TRUSTED_COOKIE_DOMAINS = ['google.com', 'youtube.com', 'youtu.be']

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isTrustedCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase()
  return TRUSTED_COOKIE_DOMAINS.some(
    (trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`),
  )
}

export function hasYouTubeAuthentication(cookies) {
  return cookies.some(
    (cookie) =>
      AUTH_COOKIE_NAMES.has(cookie.name) && isTrustedCookieDomain(cookie.domain),
  )
}

export function toElectronCookie(cookie) {
  if (!cookie?.name || !isTrustedCookieDomain(cookie.domain)) return null
  const hostname = cookie.domain.replace(/^\./, '')
  const isHostCookie = cookie.name.startsWith('__Host-')
  const requiresSecure = isHostCookie || cookie.name.startsWith('__Secure-')
  const path = isHostCookie ? '/' : cookie.path || '/'
  const details = {
    url: `${requiresSecure || cookie.secure !== false ? 'https' : 'http'}://${hostname}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure: requiresSecure || cookie.secure !== false,
    httpOnly: Boolean(cookie.httpOnly),
  }
  if (!isHostCookie) details.domain = cookie.domain
  const sameSite = {
    None: 'no_restriction',
    Lax: 'lax',
    Strict: 'strict',
  }[cookie.sameSite]
  if (sameSite) details.sameSite = sameSite
  if (Number.isFinite(cookie.expires) && cookie.expires > 0) {
    details.expirationDate = cookie.expires
  }
  return details
}

export async function importChromeCookies(cookies, cookieStore) {
  const nowSeconds = Date.now() / 1000
  const trusted = cookies
    .filter(
      (cookie) =>
        isTrustedCookieDomain(cookie.domain) &&
        (!Number.isFinite(cookie.expires) || cookie.expires <= 0 || cookie.expires > nowSeconds),
    )
    .map(toElectronCookie)
    .filter(Boolean)

  const results = await Promise.allSettled(
    trusted.map((cookie) => cookieStore.set(cookie)),
  )
  return results.filter((result) => result.status === 'fulfilled').length
}

export async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a Chrome debugging port')
  }
  return address.port
}

async function waitForBrowserWebSocket(port, { timeoutMs, fetchImpl }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const version = await response.json()
        if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl
      }
    } catch {
      // Chrome has not opened the loopback debugger yet.
    }
    await delay(200)
  }
  throw new Error('Timed out waiting for the Chrome sign-in window')
}

function createCdpClient(webSocketUrl, WebSocketImpl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(webSocketUrl)
    const pending = new Map()
    let nextId = 0

    socket.addEventListener('error', () => {
      reject(new Error('Could not connect to the Chrome sign-in session'))
    }, { once: true })
    socket.addEventListener('open', () => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
      })
      resolve({
        close: () => socket.close(),
        call(method, params = {}) {
          return new Promise((resolveCall, rejectCall) => {
            const id = ++nextId
            pending.set(id, { resolve: resolveCall, reject: rejectCall })
            socket.send(JSON.stringify({ id, method, params }))
          })
        },
      })
    }, { once: true })
  })
}

export async function waitForChromeAuthentication({
  port,
  timeoutMs = 5 * 60_000,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
}) {
  const webSocketUrl = await waitForBrowserWebSocket(port, {
    timeoutMs: Math.min(timeoutMs, 15_000),
    fetchImpl,
  })
  const client = await createCdpClient(webSocketUrl, WebSocketImpl)
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const { cookies = [] } = await client.call('Storage.getCookies')
      if (hasYouTubeAuthentication(cookies)) return cookies
      await delay(750)
    }
  } finally {
    client.close()
  }
  throw new Error('Google sign-in was not completed in time')
}
