import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  hasYouTubeAuthentication,
  importChromeCookies,
  isTrustedCookieDomain,
  toElectronCookie,
  waitForChromeAuthentication,
} from '../desktop/chrome-cookie-sync.mjs'

function createFakeCdpWebSocket(cookieSequence) {
  class FakeSocket {
    constructor(url) {
      this.url = url
      this.listeners = { open: [], message: [], error: [], close: [] }
      this._index = 0
      queueMicrotask(() => this.emit('open', {}))
    }

    addEventListener(type, callback) {
      this.listeners[type].push(callback)
    }

    emit(type, event) {
      for (const callback of this.listeners[type]) callback(event)
    }

    send(raw) {
      const message = JSON.parse(raw)
      const cookies = cookieSequence[this._index % cookieSequence.length]
      this._index += 1
      queueMicrotask(() =>
        this.emit('message', {
          data: JSON.stringify({ id: message.id, result: { cookies } }),
        }),
      )
    }

    close() {}
  }
  return FakeSocket
}

describe('Chrome to Electron sign-in sync', () => {
  it('accepts only Google and YouTube cookie domains', () => {
    assert.equal(isTrustedCookieDomain('.youtube.com'), true)
    assert.equal(isTrustedCookieDomain('accounts.google.com'), true)
    assert.equal(isTrustedCookieDomain('google.com.attacker.example'), false)
    assert.equal(isTrustedCookieDomain('example.com'), false)
  })

  it('detects a usable authenticated YouTube session', () => {
    assert.equal(
      hasYouTubeAuthentication([
        { name: 'SAPISID', domain: '.google.com', value: 'secret' },
      ]),
      true,
    )
    assert.equal(
      hasYouTubeAuthentication([
        { name: 'PREF', domain: '.youtube.com', value: 'settings' },
      ]),
      false,
    )
  })

  it('maps Chrome cookie attributes to Electron without logging values', () => {
    assert.deepEqual(
      toElectronCookie({
        name: 'SID',
        value: 'secret',
        domain: '.google.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        expires: 2_000_000_000,
      }),
      {
        url: 'https://google.com',
        name: 'SID',
        value: 'secret',
        domain: '.google.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction',
        expirationDate: 2_000_000_000,
      },
    )
  })

  it('omits Domain for __Host cookies and forces secure root scope', () => {
    assert.deepEqual(
      toElectronCookie({
        name: '__Host-GAPS',
        value: 'secret',
        domain: 'accounts.google.com',
        path: '/signin',
        secure: false,
      }),
      {
        url: 'https://accounts.google.com',
        name: '__Host-GAPS',
        value: 'secret',
        path: '/',
        secure: true,
        httpOnly: false,
      },
    )
  })

  it('imports trusted live cookies and ignores unrelated or expired data', async () => {
    const imported = []
    const count = await importChromeCookies(
      [
        { name: 'SID', value: 'one', domain: '.google.com', path: '/', secure: true },
        { name: 'PREF', value: 'two', domain: '.youtube.com', path: '/' },
        { name: 'bad', value: 'three', domain: '.example.com', path: '/' },
        { name: 'old', value: 'four', domain: '.youtube.com', expires: 1 },
      ],
      { async set(cookie) { imported.push(cookie) } },
    )
    assert.equal(count, 2)
    assert.deepEqual(imported.map((cookie) => cookie.name), ['SID', 'PREF'])
  })

  it('continues when Chromium rejects one optional cookie', async () => {
    const count = await importChromeCookies(
      [
        { name: 'SID', value: 'one', domain: '.google.com', path: '/' },
        { name: 'PREF', value: 'two', domain: '.youtube.com', path: '/' },
      ],
      {
        async set(cookie) {
          if (cookie.name === 'PREF') throw new Error('unsupported cookie')
        },
      },
    )
    assert.equal(count, 1)
  })

  it('completes only when the auth cookies change, not on a pre-existing session', async () => {
    const stale = [{ name: 'SID', value: 'old', domain: '.google.com', expires: 1 }]
    const fresh = [{ name: 'SID', value: 'new', domain: '.google.com', expires: 2 }]
    const cookies = await waitForChromeAuthentication({
      port: 9333,
      timeoutMs: 10_000,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ webSocketDebuggerUrl: 'ws://fake' }),
      }),
      WebSocketImpl: createFakeCdpWebSocket([stale, stale, fresh]),
    })
    assert.deepEqual(cookies, fresh)
  })

  it('does not complete while the auth snapshot stays unchanged', async () => {
    const stale = [{ name: 'SID', value: 'old', domain: '.google.com', expires: 1 }]
    await assert.rejects(
      waitForChromeAuthentication({
        port: 9333,
        timeoutMs: 1_800,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ webSocketDebuggerUrl: 'ws://fake' }),
        }),
        WebSocketImpl: createFakeCdpWebSocket([stale]),
      }),
      /Google sign-in was not completed in time/,
    )
  })

  it('ignores non-auth cookie churn when deciding to complete', async () => {
    const pre = [{ name: 'PREF', value: 'settings', domain: '.youtube.com' }]
    const withVisitor = [
      { name: 'PREF', value: 'settings', domain: '.youtube.com' },
      { name: 'VISITOR_INFO1_LIVE', value: 'x', domain: '.youtube.com' },
    ]
    await assert.rejects(
      waitForChromeAuthentication({
        port: 9333,
        timeoutMs: 1_800,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ webSocketDebuggerUrl: 'ws://fake' }),
        }),
        WebSocketImpl: createFakeCdpWebSocket([pre, withVisitor]),
      }),
      /Google sign-in was not completed in time/,
    )
  })
})
