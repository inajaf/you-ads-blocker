import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import chromeAuth from '../desktop/chrome-auth.js'

const {
  GOOGLE_LOGIN_URL,
  classifyElectronNavigation,
  createChromeHandoffArgs,
  isGoogleSignInUrl,
} = chromeAuth

describe('Electron Google sign-in handoff', () => {
  it('recognizes only supported Google and YouTube sign-in navigation', () => {
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/ServiceLogin'), true)
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/v3/signin/identifier'), true)
    assert.equal(isGoogleSignInUrl('https://www.youtube.com/signin?action_handle_signin=true'), true)
    assert.equal(
      isGoogleSignInUrl(
        'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue',
      ),
      true,
    )

    assert.equal(isGoogleSignInUrl('https://www.youtube.com/'), false)
    assert.equal(
      isGoogleSignInUrl(
        'https://accounts.google.com/InteractiveLogin?passive=true&continue=%2Fsignin_passive',
      ),
      false,
    )
    assert.equal(
      isGoogleSignInUrl('https://accounts.youtube.com/accounts/CheckConnection'),
      false,
    )
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/TOS?privacy=true'), false)
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/Logout'), false)
    assert.equal(isGoogleSignInUrl('https://accounts.google.com/ManageAccount'), false)
    assert.equal(isGoogleSignInUrl('https://accounts.google.com.attacker.example/'), false)
    assert.equal(isGoogleSignInUrl('http://accounts.google.com/ServiceLogin'), false)
    assert.equal(isGoogleSignInUrl('not a URL'), false)
  })

  it('blocks passive account checks and keeps Electron on trusted YouTube pages', () => {
    assert.equal(
      classifyElectronNavigation(
        'https://accounts.google.com/InteractiveLogin?passive=true&continue=%2Fsignin_passive',
      ),
      'block',
    )
    assert.equal(
      classifyElectronNavigation('https://accounts.youtube.com/accounts/CheckConnection'),
      'block',
    )
    assert.equal(
      classifyElectronNavigation('https://www.youtube.com/watch?v=example'),
      'allow',
    )
    assert.equal(
      classifyElectronNavigation('https://www.youtube.com/signin?action_handle_signin=true'),
      'handoff',
    )
    assert.equal(classifyElectronNavigation('https://example.com/help'), 'external')
    assert.equal(classifyElectronNavigation('javascript:alert(1)'), 'block')
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
    assert.match(decodeURIComponent(GOOGLE_LOGIN_URL), /tube_guide=done/)
  })

  it('wires main-frame, redirect, and popup navigation to the navigation policy', () => {
    const mainSource = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
    assert.match(mainSource, /will-navigate/)
    assert.match(mainSource, /will-redirect/)
    assert.match(mainSource, /setWindowOpenHandler/)
    assert.match(mainSource, /classifyElectronNavigation/)
    assert.match(mainSource, /details\.isMainFrame/)
    assert.match(mainSource, /return \{ action: 'deny' \}/)
    assert.match(mainSource, /contextIsolation:\s*true/)
  })

  it('builds and loads the current extension in every Chrome login flow', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'),
    )
    const loginSource = fs.readFileSync(
      new URL('../desktop/login-and-start.mjs', import.meta.url),
      'utf8',
    )
    assert.match(packageJson.scripts.prelogin, /build:extension/)
    assert.match(loginSource, /--load-extension=/)
    assert.match(loginSource, /--disable-extensions-except=/)
  })
})
