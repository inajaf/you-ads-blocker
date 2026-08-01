import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const mainSource = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8')
const preloadSource = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8')
const ipcSource = fs.readFileSync(new URL('../desktop/tab-ipc.js', import.meta.url), 'utf8')
const tabModelSource = fs.readFileSync(new URL('../desktop/tab-model.js', import.meta.url), 'utf8')
const tabStripSource = fs.readFileSync(new URL('../desktop/tab-strip.js', import.meta.url), 'utf8')
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
    assert.match(mainSource, /loadFile\(path\.join\(__dirname, 'tab-strip\.html'\)\)/)
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

  it('injects the click interceptor in the preload with an isolated bridge', () => {
    assert.match(preloadSource, /desktop-tab-open\.js/)
    assert.match(preloadSource, /NoirvaDesktopTabOpen\.register\(window\)/)
    assert.match(preloadSource, /NoirvaDesktopTabOpen\.OPEN_VIDEO_EVENT/)
    assert.match(preloadSource, /ipcRenderer\.send\(TAB_OPEN_CHANNEL, url\)/)
    assert.match(preloadSource, /isVideoUrl/)
  })

  it('exposes an allowlisted tab-strip API with a state pull to avoid a race', () => {
    assert.match(tabStripPreloadSource, /contextBridge\.exposeInMainWorld\('advoidTabs'/)
    assert.match(tabStripPreloadSource, /ipcRenderer\.invoke\(TAB_STRIP_CHANNELS\.getState\)/)
    assert.match(tabStripSource, /advoidTabs\.getState\(\)/)
    assert.match(tabStripSource, /advoidTabs\.onState/)
    assert.match(tabModelSource, /module\.exports/)
  })
})
