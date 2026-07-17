'use strict'

const { spawn } = require('child_process')
const { app, BrowserWindow, dialog, Menu, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { createChromeHandoffArgs, isGoogleSignInUrl } = require('./chrome-auth')

// Keep YouTube rendering consistent with the Chromium engine bundled in this
// Electron build. Google account authentication is handled separately in a
// supported Chrome window because changing the UA cannot make Electron an
// accepted Google sign-in client.
const chromeVersion = process.versions.chrome
const chromeUserAgent = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  `Chrome/${chromeVersion}`,
  'Safari/537.36',
].join(' ')
app.userAgentFallback = chromeUserAgent

// --- Load the shared ad-host blocklist (single source of truth in ../adblock) ---
const hostsPath = path.join(__dirname, '..', 'adblock', 'hosts.json')
let blockList = []
try {
  const parsed = JSON.parse(fs.readFileSync(hostsPath, 'utf8'))
  blockList = Array.isArray(parsed.block) ? parsed.block : []
  console.log(`[Tube] loaded ${blockList.length} block substrings from ${hostsPath}`)
} catch (err) {
  console.error('[Tube] failed to load hosts.json:', err)
}

// Module-level counter so blocking is observable in stdout.
let blockedCount = 0

function registerNetworkBlocking(sess) {
  sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const url = details.url || ''
    for (const needle of blockList) {
      if (url.includes(needle)) {
        blockedCount += 1
        console.log(`[block] ${url}`)
        if (blockedCount % 10 === 0) {
          console.log(`[block] running total: ${blockedCount} requests blocked`)
        }
        return cb({ cancel: true })
      }
    }
    return cb({})
  })
}

let mainWindow = null
let chromeHandoffStarted = false

function findExtensionDir() {
  const candidates = [
    path.join(__dirname, '..', 'extension'),
    path.join(__dirname, '..', 'dist-extension'),
  ]
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'manifest.json')))
}

function showChromeHandoffError(error) {
  chromeHandoffStarted = false
  console.error('[Tube] failed to open supported Chrome sign-in:', error)
  mainWindow?.show()
  dialog.showErrorBox(
    'Chrome sign-in is unavailable',
    `${error.message}\n\nInstall the Tube Chrome runtime or set TUBE_CHROME_PATH and try again.`,
  )
}

async function openSupportedChromeSignIn() {
  if (chromeHandoffStarted) return
  chromeHandoffStarted = true

  try {
    const { chromePath, profileDir } = await import('./runtime-paths.mjs')
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome for Testing was not found at ${chromePath}`)
    }

    const extensionDir = findExtensionDir()
    if (!extensionDir) {
      throw new Error('The Tube Chrome extension is not available')
    }

    const chrome = spawn(
      chromePath,
      createChromeHandoffArgs({ profileDir, extensionDir }),
      { detached: true, stdio: 'ignore' },
    )
    chrome.once('error', showChromeHandoffError)
    chrome.once('spawn', () => {
      chrome.unref()
      console.log('[Tube] Google sign-in handed off to supported Chrome')
      app.quit()
    })
  } catch (error) {
    showChromeHandoffError(error)
  }
}

function redirectGoogleSignIn(event, url) {
  if (!isGoogleSignInUrl(url)) return false
  event.preventDefault()
  void openSupportedChromeSignIn()
  return true
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Tube',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
    },
  })

  // Read as an app, not a browser: no application menu.
  Menu.setApplicationMenu(null)
  mainWindow.setTitle('Tube')

  // Surface the renderer console (incl. the inject success line) in main stdout.
  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log('[renderer]', message)
  })

  // Also pin the top-level webContents UA for normal YouTube browsing.
  mainWindow.webContents.setUserAgent(chromeUserAgent)

  mainWindow.webContents.on('will-navigate', (event, url) => {
    redirectGoogleSignIn(event, url)
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    redirectGoogleSignIn(event, url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isGoogleSignInUrl(url)) return { action: 'allow' }
    void openSupportedChromeSignIn()
    return { action: 'deny' }
  })

  mainWindow.loadURL('https://www.youtube.com')

  // TEMP-VERIFY: screenshot a few seconds after load to prove real youtube loads.
  if (process.env.TUBE_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await mainWindow.webContents.capturePage()
          fs.writeFileSync(
            path.join(__dirname, 'screenshot.png'),
            img.toPNG(),
          )
          console.log('[Tube] screenshot saved')
        } catch (e) {
          console.error('[Tube] screenshot failed:', e)
        }
        setTimeout(() => app.quit(), 1500)
      }, 6000)
    })
  }
}

app.whenReady().then(() => {
  // Keep normal renderer state persistent. Google authentication itself is
  // redirected to the dedicated Chrome profile above.
  registerNetworkBlocking(session.defaultSession)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
