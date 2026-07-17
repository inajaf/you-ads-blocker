import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import chromeAuth from '../desktop/chrome-auth.js'

const { GOOGLE_LOGIN_URL, createChromeHandoffArgs, isGoogleSignInUrl } = chromeAuth

describe('Electron Google sign-in handoff', () => {
  it('recognizes only supported Google and YouTube sign-in navigation', () => {
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/ServiceLogin'), true)
    assert.equal(isGoogleSignInUrl('https://accounts.youtube.com/accounts/CheckConnection'), true)
    assert.equal(isGoogleSignInUrl('https://www.youtube.com/signin?action_handle_signin=true'), true)

    assert.equal(isGoogleSignInUrl('https://www.youtube.com/'), false)
    assert.equal(isGoogleSignInUrl('https://accounts.google.com.attacker.example/'), false)
    assert.equal(isGoogleSignInUrl('http://accounts.google.com/ServiceLogin'), false)
    assert.equal(isGoogleSignInUrl('not a URL'), false)
  })

  it('opens Chrome with the private profile, extension, and Tube app return URL', () => {
    const args = createChromeHandoffArgs({
      profileDir: '/tmp/tube-profile',
      extensionDir: '/tmp/tube-extension',
    })

    assert.ok(args.includes('--user-data-dir=/tmp/tube-profile'))
    assert.ok(args.includes('--load-extension=/tmp/tube-extension'))
    assert.ok(args.includes('--disable-extensions-except=/tmp/tube-extension'))
    assert.ok(args.includes(`--app=${GOOGLE_LOGIN_URL}`))
    assert.match(decodeURIComponent(GOOGLE_LOGIN_URL), /youtube\.com\/\?tube_app=1/)
  })

  it('wires main-frame, redirect, and popup navigation to the handoff', () => {
    const mainSource = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
    assert.match(mainSource, /will-navigate/)
    assert.match(mainSource, /will-redirect/)
    assert.match(mainSource, /setWindowOpenHandler/)
    assert.match(mainSource, /openSupportedChromeSignIn/)
  })
})
