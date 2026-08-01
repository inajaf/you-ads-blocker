'use strict'

// This preload keeps its Node.js helpers isolated from YouTube. Page patches and
// the shared guide are installed explicitly in the page's MAIN world through
// webFrame.executeJavaScript.
//
// A plain `(0,eval)(code)` is blocked on youtube.com by its Trusted Types CSP
// (`require-trusted-types-for 'script'`), which forbids evaluating strings as
// JS. So we use Electron's webFrame.executeJavaScript, which compiles the source
// directly via V8 (not through the eval sink) and executes in the page's main
// world, bypassing the CSP restriction.

const fs = require('fs')
const path = require('path')
const { ipcRenderer, webFrame } = require('electron')
const { resolveProjectPath } = require('./project-path')
const { TAB_OPEN_CHANNEL } = require('./tab-ipc')
const NoirvaDesktopTabOpen = require('./desktop-tab-open')

const ELECTRON_GUIDE_STORAGE_KEY = 'tube.electronDesktopGuideVersion'
const NOIRVA_LOGO_PATH = ['extension', 'icons', 'noirva-logo-v2-128.png']

function readProjectFile(...segments) {
  return fs.readFileSync(resolveProjectPath(...segments), 'utf8')
}

function readProjectImageDataUrl(segments) {
  const bytes = fs.readFileSync(resolveProjectPath(...segments))
  return `data:image/png;base64,${bytes.toString('base64')}`
}

async function executeProjectScript(segments, label) {
  await webFrame.executeJavaScript(readProjectFile(...segments))
  console.log(`[Noirva] preload injected ${label} into page world`)
}

async function initializePage() {
  const logoUrl = readProjectImageDataUrl(NOIRVA_LOGO_PATH)
  await executeProjectScript(['adblock', 'inject.js'], 'adblock/inject.js')

  webFrame.insertCSS(readProjectFile('extension', 'content.css'))

  // Explicit "open in a new tab" gestures on video links in the page world
  // (Cmd/Ctrl+click, middle-click) are turned into requests that this
  // isolated-world bridge forwards to the main process. Plain single clicks
  // are left alone so YouTube's SPA navigates the current tab.
  // This file ships inside app.asar next to the preload, so it is read from
  // __dirname (not resolveProjectPath, which targets packaged resources).
  await webFrame.executeJavaScript(
    fs.readFileSync(path.join(__dirname, 'desktop-tab-open.js'), 'utf8'),
  )
  console.log('[Noirva] preload injected desktop/desktop-tab-open.js into page world')
  await webFrame.executeJavaScript(
    'globalThis.NoirvaDesktopTabOpen.register(window)',
  )
  window.addEventListener(NoirvaDesktopTabOpen.OPEN_VIDEO_EVENT, (event) => {
    const url = event.detail && event.detail.url
    if (typeof url === 'string' && NoirvaDesktopTabOpen.isVideoUrl(url)) {
      ipcRenderer.send(TAB_OPEN_CHANNEL, url)
    }
  })

  await executeProjectScript(
    ['extension', 'desktop-guide.js'],
    'extension/desktop-guide.js',
  )
  await executeProjectScript(
    ['extension', 'desktop-guide-ui.js'],
    'extension/desktop-guide-ui.js',
  )

  await webFrame.executeJavaScript(`
    globalThis.TubeDesktopGuideUI.install({
      guide: globalThis.TubeDesktopGuide.forEnvironment('electron'),
      storage: globalThis.TubeDesktopGuideUI.createWebStorageAdapter(
        globalThis.localStorage,
        ${JSON.stringify(ELECTRON_GUIDE_STORAGE_KEY)}
      ),
      logoUrl: ${JSON.stringify(logoUrl)},
    })
  `)
  console.log('[Noirva] Electron first-run guide initialized')
}

initializePage().catch((error) => {
  console.error('[Noirva] preload initialization failed:', error)
})
