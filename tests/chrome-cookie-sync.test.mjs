import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  hasYouTubeAuthentication,
  importChromeCookies,
  isTrustedCookieDomain,
  toElectronCookie,
} from '../desktop/chrome-cookie-sync.mjs'

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
})
