'use strict'

const { app, BrowserWindow, Menu, session } = require('electron')
const path = require('path')
const fs = require('fs')

// Google rejects Electron's default `Electron/x.y` browser token during sign-in.
// Use the exact Chromium engine bundled with this Electron build while keeping
// the normal desktop Chrome UA shape. This is applied before any window or
// network session is created so accounts.google.com sees one consistent UA.
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

  // Also pin the top-level webContents UA. The default session is persistent,
  // so Google cookies survive normal application restarts after sign-in.
  mainWindow.webContents.setUserAgent(chromeUserAgent)

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
  // Use the default (persistent) session so Google login/cookies persist.
  registerNetworkBlocking(session.defaultSession)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
