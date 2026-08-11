import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const mainSource = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
const preloadSource = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8')
const ipcSource = fs.readFileSync(new URL('../desktop/tab-ipc.js', import.meta.url), 'utf8')
const tabModelSource = fs.readFileSync(new URL('../desktop/tab-model.js', import.meta.url), 'utf8')
const tabStripSource = fs.readFileSync(new URL('../desktop/tab-strip.js', import.meta.url), 'utf8')
const tabStripHtml = fs.readFileSync(new URL('../desktop/tab-strip.html', import.meta.url), 'utf8')
const tabStripPreloadSource = fs.readFileSync(
  new URL('../desktop/tab-strip-preload.js', import.meta.url),
  'utf8',
)

describe('AdVoid desktop multi-tab wiring', () => {
  it('renders tabs as isolated WebContentsViews below an in-window strip', () => {
    assert.match(mainSource, /WebContentsView/)
    assert.match(mainSource, /contentView\.addChildView/)
    assert.match(mainSource, /setVisible/)
    assert.match(mainSource, /STRIP_HEIGHT/)
    assert.match(
      mainSource,
      /loadFile\([\s\S]*path\.join\(__dirname, 'tab-strip\.html'\)[\s\S]*createTabStripLoadOptions\(\)/,
    )
    assert.match(mainSource, /backgroundThrottling:\s*false/)
    assert.match(mainSource, /contextIsolation:\s*true/)
  })

  it('routes video opens, tab clicks and window.open through a shared tab model', () => {
    assert.match(mainSource, /createTabModel\(\)/)
    assert.match(mainSource, /isVideoOpenUrl/)
    assert.match(mainSource, /will-navigate/)
    assert.match(mainSource, /setWindowOpenHandler/)
    assert.match(mainSource, /return \{ action: 'deny' \}/)
    assert.match(mainSource, /require\('\.\/tab-ipc'\)/)
    assert.match(mainSource, /require\('\.\/tab-model'\)/)

    assert.match(ipcSource, /advoid:tab-new/)
    assert.match(ipcSource, /advoid:tab-select/)
    assert.match(ipcSource, /advoid:tab-close/)
    assert.match(ipcSource, /advoid:tabs-updated/)
    assert.match(ipcSource, /advoid:tabs-get-state/)
    assert.match(ipcSource, /advoid:open-video-tab/)
  })

  it('shares one session so blocklisting and sign-in apply to every tab', () => {
    assert.match(mainSource, /registerNetworkBlocking\(session\.defaultSession\)/)
  })

  it('handles trusted click gestures directly in the isolated preload', () => {
    assert.match(preloadSource, /require\('\.\/desktop-tab-open'\)/)
    assert.match(preloadSource, /NoirvaDesktopTabOpen\.register\(window, \(url\)/)
    assert.match(preloadSource, /ipcRenderer\.send\(TAB_OPEN_CHANNEL, url\)/)
    assert.doesNotMatch(preloadSource, /OPEN_VIDEO_EVENT/)
  })

  it('exposes an allowlisted tab-strip API with a state pull to avoid a race', () => {
    assert.match(tabStripPreloadSource, /contextBridge\.exposeInMainWorld\('advoidTabs'/)
    assert.match(tabStripPreloadSource, /ipcRenderer\.invoke\(TAB_STRIP_CHANNELS\.getState\)/)
    assert.match(tabStripSource, /advoidTabs\.getState\(\)/)
    assert.match(tabStripSource, /advoidTabs\.onState/)
    assert.match(tabModelSource, /module\.exports/)
  })

  it('keeps explicit tab opens distinct and handles fullscreen and load failures', () => {
    assert.match(mainSource, /handleWindowOpen[\s\S]*openNewTab\(url, \{ forceNew: true \}\)/)
    assert.match(mainSource, /open-in-new-tab'[\s\S]*forceNew: true/)
    assert.match(mainSource, /TAB_OPEN_CHANNEL[\s\S]*forceNew: true/)
    assert.match(mainSource, /enter-html-full-screen/)
    assert.match(mainSource, /leave-html-full-screen/)
    assert.match(mainSource, /loadURL\(tab\.url\)\.catch/)
  })

  it('scrolls overflowing tabs and keeps the active tab visible', () => {
    assert.match(tabStripHtml, /#tabs[\s\S]*overflow-x:\s*auto/)
    assert.match(tabStripSource, /scrollIntoView/)
  })

  it('keeps macOS traffic lights clear and makes empty strip space draggable', () => {
    assert.match(tabStripSource, /document\.body\.dataset\.platform = platform/)
    assert.match(tabStripHtml, /data-platform='darwin'/)
    assert.match(tabStripHtml, /padding-left:\s*82px/)
    assert.match(tabStripHtml, /-webkit-app-region:\s*drag/)
    assert.match(tabStripHtml, /-webkit-app-region:\s*no-drag/)
  })

  it('routes macOS tab shortcuts through the native menu', () => {
    assert.match(mainSource, /require\('\.\/application-menu'\)/)
    assert.match(
      mainSource,
      /function installTabShortcuts\(contents\) \{[\s\S]*process\.platform === 'darwin'[\s\S]*return/,
    )
    assert.match(mainSource, /createWindow\(\)[\s\S]*installApplicationMenu\(\)/)
  })
})
