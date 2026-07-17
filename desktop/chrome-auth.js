'use strict'

const TUBE_APP_URL = 'https://www.youtube.com/?tube_app=1'
const GOOGLE_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent(TUBE_APP_URL)

function isGoogleSignInUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()
  if (host === 'accounts.google.com' || host === 'accounts.youtube.com') return true

  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com')
  return isYouTube && /^\/signin(?:\/|$)/.test(url.pathname)
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
    `--app=${GOOGLE_LOGIN_URL}`,
  ]
}

module.exports = {
  GOOGLE_LOGIN_URL,
  TUBE_APP_URL,
  createChromeHandoffArgs,
  isGoogleSignInUrl,
}
