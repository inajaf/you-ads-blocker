'use strict'

const TUBE_APP_URL = 'https://www.youtube.com/?tube_app=1&tube_guide=done'
const GOOGLE_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent(TUBE_APP_URL)

function parseHttpsUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  return url.protocol === 'https:' ? url : null
}

function hasPassiveSignInMarker(url) {
  if (url.pathname.includes('/signin_passive')) return true

  for (const value of url.searchParams.values()) {
    if (value.includes('/signin_passive')) return true
  }
  return false
}

function isGoogleSignInUrl(rawUrl) {
  const url = parseHttpsUrl(rawUrl)
  if (!url || hasPassiveSignInMarker(url)) return false

  const host = url.hostname.toLowerCase()
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com')
  if (isYouTube) return /^\/signin(?:\/|$)/.test(url.pathname)

  if (host !== 'accounts.google.com') return false
  return /^\/(?:ServiceLogin|InteractiveLogin|AccountChooser|AddSession|signin(?:\/|$)|v\d+\/signin(?:\/|$))/.test(
    url.pathname,
  )
}

function classifyElectronNavigation(rawUrl) {
  const url = parseHttpsUrl(rawUrl)
  if (!url) return 'block'
  if (isGoogleSignInUrl(url.href)) return 'handoff'

  const host = url.hostname.toLowerCase()
  if (host === 'accounts.google.com' || host === 'accounts.youtube.com') {
    return 'block'
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) return 'allow'
  return 'external'
}

function createChromeHandoffArgs({ profileDir, extensionDir }) {
  if (!profileDir) throw new TypeError('A Chrome profile directory is required')
  if (!extensionDir) throw new TypeError('A Chrome extension directory is required')

  return [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-infobars',
    '--disable-translate',
    '--disable-features=Translate,TranslateUI',
    `--app=${GOOGLE_LOGIN_URL}`,
  ]
}

module.exports = {
  GOOGLE_LOGIN_URL,
  TUBE_APP_URL,
  classifyElectronNavigation,
  createChromeHandoffArgs,
  isGoogleSignInUrl,
}
