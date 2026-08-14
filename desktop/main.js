'use strict'

const { spawn } = require('child_process')
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  WebContentsView,
} = require('electron')
const path = require('path')
const fs = require('fs')
const { resolveProjectPath } = require('./project-path')
const { classifyElectronNavigation, createChromeHandoffArgs } = require('./chrome-auth')
const { createTabModel, HOME_URL, isVideoOpenUrl, isYouTubeUrl } = require('./tab-model')
const { buildContextMenuItems } = require('./tab-context-menu')
const { createApplicationMenuTemplate } = require('./application-menu')
const { resolveVersionedExtensionDir } = require('./extension-path')
const { TAB_OPEN_CHANNEL, TAB_STRIP_CHANNELS } = require('./tab-ipc')
// autoUpdater lives in an optional dependency so dev/electron-less tooling
// (Node-only scripts) can require this file without pulling in the updater.
let autoUpdater = null
try {
  // eslint-disable-next-line global-require
  autoUpdater = require('electron-updater').autoUpdater
} catch (error) {
  console.error('[AdVoid] electron-updater unavailable, auto-update disabled:', error)
}
const {
  createDesktopWindowOptions,
  createTabStripLoadOptions,
} = require('./window-options')

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
app.setName('AdVoid')

// Height of the in-window tab strip; video pages render below it.
const STRIP_HEIGHT = 42

// --- Load the shared ad-host blocklist (single source of truth in ../adblock) ---
const hostsPath = resolveProjectPath('adblock', 'hosts.json')
let blockList = []
try {
  const parsed = JSON.parse(fs.readFileSync(hostsPath, 'utf8'))
  blockList = Array.isArray(parsed.block) ? parsed.block : []
  console.log(`[AdVoid] loaded ${blockList.length} block substrings from ${hostsPath}`)
} catch (err) {
  console.error('[AdVoid] failed to load hosts.json:', err)
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
let tabModel = null
let stripView = null
let stripContents = null
const viewsByTabId = new Map()
let chromeHandoffStarted = false
let htmlFullscreenTabId = null

function findExtensionDir() {
  const candidates = [
    resolveProjectPath('dist-extension'),
    resolveProjectPath('extension'),
  ]
  for (const dir of candidates) {
    const resolved = resolveVersionedExtensionDir(dir)
    if (resolved) return resolved
  }
  return null
}

function showChromeHandoffError(error) {
  chromeHandoffStarted = false
  console.error('[AdVoid] failed to open supported Chrome sign-in:', error)
  mainWindow?.show()
  dialog.showErrorBox(
    'Chrome sign-in is unavailable',
    `${error.message}\n\nInstall the AdVoid Chrome runtime or set ADVOID_CHROME_PATH and try again.`,
  )
}

async function openSupportedChromeSignIn() {
  if (chromeHandoffStarted) return
  chromeHandoffStarted = true
  let chrome = null

  try {
    const { chromePath, profileDir } = await import('./runtime-paths.mjs')
    const { isChromeProfileBusy, isChromeProfileRunning, stopChromeProfile } = await import(
      './chrome-launch.mjs'
    )
    const {
      importChromeCookies,
      reserveLoopbackPort,
      waitForChromeAuthentication,
    } = await import('./chrome-cookie-sync.mjs')
    const { prepareChromeRuntimeBranding } = await import('./runtime-branding.mjs')
    const { prepareNoirvaProfilePreferences } = await import(
      './profile-preferences.mjs'
    )
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Chrome for Testing was not found at ${chromePath}`)
    }

    prepareChromeRuntimeBranding(chromePath)
    if (await isChromeProfileRunning({ chromePath, profileDir })) {
      await stopChromeProfile({ chromePath, profileDir })
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!(await isChromeProfileBusy({ chromePath, profileDir }))) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (await isChromeProfileBusy({ chromePath, profileDir })) {
        throw new Error('Close the existing AdVoid sign-in window and try again')
      }
    }
    prepareNoirvaProfilePreferences(profileDir)

    const extensionDir = findExtensionDir()
    if (!extensionDir) {
      throw new Error('The AdVoid Chrome extension is not available')
    }

    const debuggingPort = await reserveLoopbackPort()
    chrome = spawn(
      chromePath,
      createChromeHandoffArgs({ profileDir, extensionDir, debuggingPort }),
      { stdio: 'ignore' },
    )
    const chromeClosed = new Promise((_, reject) => {
      chrome.once('error', reject)
      chrome.once('exit', (code, signal) => {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`
        reject(new Error(`Chrome sign-in closed before completion (${reason})`))
      })
    })
    mainWindow?.hide()
    const cookies = await Promise.race([
      waitForChromeAuthentication({ port: debuggingPort }),
      chromeClosed,
    ])
    const importedCount = await importChromeCookies(
      cookies,
      session.defaultSession.cookies,
    )
    if (importedCount === 0) {
      throw new Error('Chrome did not provide a usable YouTube session')
    }
    await session.defaultSession.cookies.flushStore()
    if (chrome.exitCode === null) chrome.kill()
    chrome = null

    for (const view of viewsByTabId.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.reload()
    }
    mainWindow?.show()
    mainWindow?.focus()
    chromeHandoffStarted = false
    console.log(`[AdVoid] signed-in session imported into ${viewsByTabId.size} app tabs`)
  } catch (error) {
    if (chrome?.exitCode === null) chrome.kill()
    mainWindow?.show()
    mainWindow?.focus()
    chromeHandoffStarted = false
    showChromeHandoffError(error)
  }
}

// --- Tab state + chrome ----------------------------------------------------

function buildTabStripState() {
  return {
    activeId: tabModel.activeId,
    tabs: tabModel.getTabs().map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.id === tabModel.activeId,
      loading: tab.loading,
    })),
  }
}

function syncTabStrip() {
  if (!stripContents || stripContents.isDestroyed()) return
  stripContents.send(TAB_STRIP_CHANNELS.setState, buildTabStripState())
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const stripVisible = htmlFullscreenTabId === null
  const contentTop = stripVisible ? STRIP_HEIGHT : 0
  const contentHeight = Math.max(0, height - contentTop)
  if (stripView) {
    stripView.setVisible(stripVisible)
    stripView.setBounds({ x: 0, y: 0, width, height: STRIP_HEIGHT })
  }
  for (const view of viewsByTabId.values()) {
    view.setBounds({ x: 0, y: contentTop, width, height: contentHeight })
  }
}

function activateTab(tabId) {
  if (!tabModel.selectTab(tabId)) return
  for (const [id, view] of viewsByTabId) {
    const isActive = id === tabId
    view.setVisible(isActive)
    if (isActive) view.webContents.focus()
  }
  syncTabStrip()
}

function selectTab(tabId) {
  if (tabModel.selectTab(tabId)) activateTab(tabId)
}

function openNewTab(url = HOME_URL, { forceNew = false } = {}) {
  const { tab, created } = tabModel.openTab(url, { forceNew })
  if (created) createTabView(tab)
  activateTab(tab.id)
  return tab
}

function closeTab(tabId) {
  if (htmlFullscreenTabId === tabId) htmlFullscreenTabId = null
  const view = viewsByTabId.get(tabId)
  if (view) {
    viewsByTabId.delete(tabId)
    mainWindow?.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
  tabModel.closeTab(tabId)
  if (tabModel.isEmpty()) {
    openNewTab(HOME_URL)
  } else {
    layoutViews()
    activateTab(tabModel.activeId)
  }
}

function createTabView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // Keep background tabs' timers/players running so videos keep playing
      // while another tab is focused (browser-like parallel playback).
      backgroundThrottling: false,
    },
  })
  const contents = view.webContents
  contents.setUserAgent(chromeUserAgent)
  attachTabListeners(contents, tab.id)
  mainWindow.contentView.addChildView(view)
  view.setVisible(false)
  viewsByTabId.set(tab.id, view)
  layoutViews()
  void contents.loadURL(tab.url).catch((error) => {
    console.error(`[AdVoid] tab ${tab.id} failed to load ${tab.url}:`, error)
  })
  return view
}

// --- Navigation policy (per tab) ------------------------------------------

function handleTabNavigation(tabId, details) {
  if (!details.isMainFrame) return

  // Plain navigations (SPA or full-page) always happen in the current tab —
  // Chrome conventions: new tabs are created only by explicit gestures
  // (Cmd/Ctrl+click, middle-click, context menu), handled via the isolated
  // preload interceptor or window.open, not by hijacking navigations here.
  const action = classifyElectronNavigation(details.url)
  if (action === 'allow') return

  details.preventDefault()
  if (action === 'handoff') {
    void openSupportedChromeSignIn()
    return
  }
  if (action === 'external') {
    void shell.openExternal(details.url).catch((error) => {
      console.error('[AdVoid] failed to open external link:', error)
    })
  }
}

function handleWindowOpen({ url }) {
  const action = classifyElectronNavigation(url)
  if (action === 'handoff') void openSupportedChromeSignIn()
  else if (action === 'allow') openNewTab(url, { forceNew: true })
  else if (action === 'external') {
    void shell.openExternal(url).catch((error) => {
      console.error('[AdVoid] failed to open external link:', error)
    })
  }
  return { action: 'deny' }
}

function installTabShortcuts(contents) {
  // macOS routes Command accelerators through the native application menu.
  // BrowserWindow's default Cmd+W closes the whole window if the renderer
  // hook misses an event, so keep this hook as the Windows/Linux fallback.
  if (process.platform === 'darwin') return
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const primary = process.platform === 'darwin' ? input.meta : input.control
    if (!primary || input.alt || input.shift) return
    const key = input.key.toLowerCase()
    if (key === 't') {
      event.preventDefault()
      openNewTab(HOME_URL, { forceNew: true })
    } else if (key === 'w') {
      event.preventDefault()
      if (tabModel.activeId !== null) closeTab(tabModel.activeId)
    }
  })
}

function installApplicationMenu() {
  const template = createApplicationMenuTemplate({
    platform: process.platform,
    appName: 'AdVoid',
    onNewTab: () => {
      if (tabModel) openNewTab(HOME_URL, { forceNew: true })
    },
    onCloseTab: () => {
      if (tabModel && tabModel.activeId !== null) closeTab(tabModel.activeId)
    },
  })
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null)
}

// Right-click menu for a tab. YouTube links get a native "Open in New Tab" item
// (matching the modifier/middle-click gestures); the rest is a minimal
// browser-style menu. Electron shows no context menu by default, so without
// this a trackpad two-finger tap on macOS does nothing.
function showContextMenu(contents, params) {
  const items = buildContextMenuItems(params, {
    isAllowedUrl: isYouTubeUrl,
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
  })
  if (items.length === 0) return
  const menu = Menu.buildFromTemplate(
    items.map((item) => {
      if (item.type === 'separator') return { type: 'separator' }
      return {
        label: item.label,
        enabled: item.enabled,
        click: () => {
          if (item.id === 'open-in-new-tab')
            openNewTab(params.linkURL, { forceNew: true })
          else if (item.id === 'copy-link') clipboard.writeText(params.linkURL)
          else if (item.id === 'copy-selection')
            clipboard.writeText(params.selectionText)
          else if (item.id === 'back') contents.goBack()
          else if (item.id === 'forward') contents.goForward()
          else if (item.id === 'reload') contents.reload()
        },
      }
    }),
  )
  menu.popup({ window: BrowserWindow.fromWebContents(contents) })
}

function attachTabListeners(contents, tabId) {
  // Surface the renderer console (incl. the inject success line) in main stdout.
  contents.on('console-message', (event, level, message) => {
    console.log('[renderer]', message)
  })

  contents.on('will-navigate', (details) => handleTabNavigation(tabId, details))
  contents.on('will-redirect', (details) =>
    handleTabNavigation(tabId, details),
  )
  contents.setWindowOpenHandler(handleWindowOpen)
  contents.on('context-menu', (event, params) => showContextMenu(contents, params))

  contents.on('page-title-updated', (event, title) => {
    if (tabModel.setTitle(tabId, title)) syncTabStrip()
  })
  contents.on('did-start-loading', () => {
    if (tabModel.setLoading(tabId, true)) syncTabStrip()
  })
  contents.on('did-stop-loading', () => {
    if (tabModel.setLoading(tabId, false)) syncTabStrip()
  })
  contents.on('did-navigate', (event, url) => {
    if (tabModel.setUrl(tabId, url)) syncTabStrip()
  })
  contents.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame && tabModel.setUrl(tabId, url)) syncTabStrip()
  })
  contents.on('enter-html-full-screen', () => {
    // Electron 43 already switches the window to fullscreen for an HTML
    // fullscreen request; only track it so the tab strip hides. Calling
    // setFullScreen() here races the built-in transition and can hang the
    // renderer's requestFullscreen(), leaving the video stuck at windowed size.
    htmlFullscreenTabId = tabId
    layoutViews()
  })
  contents.on('leave-html-full-screen', () => {
    if (htmlFullscreenTabId === tabId) htmlFullscreenTabId = null
    layoutViews()
  })

  installTabShortcuts(contents)
}

function isTrustedTabSender(sender) {
  for (const view of viewsByTabId.values()) {
    if (view.webContents === sender) return true
  }
  return false
}

function installIpcHandlers() {
  ipcMain.handle(TAB_STRIP_CHANNELS.getState, () => buildTabStripState())

  ipcMain.on(TAB_STRIP_CHANNELS.selectTab, (event, id) => {
    if (Number.isInteger(id)) selectTab(id)
  })
  ipcMain.on(TAB_STRIP_CHANNELS.closeTab, (event, id) => {
    if (Number.isInteger(id)) closeTab(id)
  })
  ipcMain.on(TAB_STRIP_CHANNELS.newTab, () => openNewTab(HOME_URL, { forceNew: true }))

  // Sent by the isolated preload click interceptor when an
  // explicit new-tab gesture (Cmd/Ctrl+click, middle-click) hits a video link.
  // Only trusted tab renderers and video URLs are accepted so a compromised
  // page can only ever open a YouTube tab.
  ipcMain.on(TAB_OPEN_CHANNEL, (event, url) => {
    if (typeof url !== 'string' || !isVideoOpenUrl(url)) return
    if (!isTrustedTabSender(event.sender)) return
    openNewTab(url, { forceNew: true })
  })
}

// --- Window + strip --------------------------------------------------------

function createTabStrip() {
  stripView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'tab-strip-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })
  mainWindow.contentView.addChildView(stripView)
  stripContents = stripView.webContents
  stripContents.on('console-message', (event, level, message) => {
    console.log('[strip]', message)
  })
  installTabShortcuts(stripContents)
  void stripContents
    .loadFile(
      path.join(__dirname, 'tab-strip.html'),
      createTabStripLoadOptions(),
    )
    .catch((error) => {
      console.error('[AdVoid] tab strip failed to load:', error)
    })
}

function scheduleScreenshotIfRequested() {
  if (
    !(
      process.env.ADVOID_SCREENSHOT ||
      process.env.NOIRVA_SCREENSHOT ||
      process.env.TUBE_SCREENSHOT
    )
  )
    return
  const view = viewsByTabId.get(tabModel.activeId)
  if (!view) return
  view.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const img = await view.webContents.capturePage()
        fs.writeFileSync(path.join(__dirname, 'screenshot.png'), img.toPNG())
        console.log('[AdVoid] screenshot saved')
      } catch (error) {
        console.error('[AdVoid] screenshot failed:', error)
      }
      setTimeout(() => app.quit(), 1500)
    }, 6000)
  })
}

// electron-updater expects a console-style logger; route through the same
// [AdVoid] prefix so updater logs are greppable alongside the rest.
const updaterLogger = {
  debug: (message) => console.log(`[AdVoid][auto-update] ${message}`),
  info: (message) => console.log(`[AdVoid][auto-update] ${message}`),
  warn: (message) => console.warn(`[AdVoid][auto-update] ${message}`),
  error: (message) => console.error(`[AdVoid][auto-update] ${message}`),
}

// Updater errors can arrive as strings or objects depending on the sink;
// normalize so logging never throws inside an error handler.
function updaterErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

// Silent background update check for packaged builds. Errors must never crash
// the app: Gatekeeper/network/feed failures downgrade to a logged note only.
function setupAutoUpdate() {
  if (!app.isPackaged || !autoUpdater) return
  autoUpdater.logger = updaterLogger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => {
    updaterLogger.error(`update check failed (non-fatal): ${updaterErrorMessage(error)}`)
  })

  autoUpdater.on('update-available', () => {
    updaterLogger.info('update available, downloading in the background')
  })

  autoUpdater.on('update-not-available', () => {
    updaterLogger.info('no update available')
  })

  autoUpdater.on('update-downloaded', (info) => {
    updaterLogger.info(`update ${info.version} downloaded`)
    const win = mainWindow || BrowserWindow.getAllWindows()[0]
    const options = {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'AdVoid update ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart AdVoid to install the update and get the latest fixes.',
    }
    const onChoice = (result) => {
      if (result.response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall())
      }
    }
    if (win) {
      dialog.showMessageBox(win, options).then(onChoice).catch((error) => {
        updaterLogger.error(`update prompt failed: ${updaterErrorMessage(error)}`)
      })
    } else {
      dialog.showMessageBox(options).then(onChoice).catch((error) => {
        updaterLogger.error(`update prompt failed: ${updaterErrorMessage(error)}`)
      })
    }
  })

  autoUpdater
    .checkForUpdates()
    .catch((error) => {
      updaterLogger.error(`update check failed (non-fatal): ${updaterErrorMessage(error)}`)
    })
}

function createWindow() {
  mainWindow = new BrowserWindow(
    createDesktopWindowOptions({
      icon: resolveProjectPath('assets', 'brand', 'noirva-logo-v2-512.png'),
    }),
  )

  mainWindow.setTitle('AdVoid')

  tabModel = createTabModel()
  createTabStrip()
  openNewTab(HOME_URL)

  mainWindow.on('resize', layoutViews)
  mainWindow.on('enter-full-screen', () => layoutViews())
  // If user exits OS fullscreen with Esc, ensure the HTML fullscreen state is
  // cleared and the tab strip is restored.
  mainWindow.on('leave-full-screen', () => {
    if (htmlFullscreenTabId !== null) {
      htmlFullscreenTabId = null
      layoutViews()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    stripView = null
    stripContents = null
    viewsByTabId.clear()
    htmlFullscreenTabId = null
    tabModel = null
  })

  scheduleScreenshotIfRequested()
}

app.whenReady().then(() => {
  // Keep normal renderer state persistent. Google authentication itself is
  // redirected to the dedicated Chrome profile above. All tabs share this
  // default session (cookies/storage), which also means the blocklist applies
  // to every tab.
  registerNetworkBlocking(session.defaultSession)

  installIpcHandlers()

  // BrowserWindow.icon does not control the macOS Dock (that needs an .icns via
  // build.mac.icon when packaged); set it explicitly so dev/test launches show
  // the AdVoid icon instead of the default Electron one. macOS normally applies
  // the squircle mask to packaged .app icons, so dev needs the pre-rounded
  // variant (source PNGs are opaque rectangles).
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(
      resolveProjectPath('assets', 'brand', 'noirva-logo-v2-rounded-512.png'),
    )
  }

  createWindow()
  installApplicationMenu()

  setupAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
