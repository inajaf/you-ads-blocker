/** Service worker — owns the effective Shield + DNR state. */

importScripts('desktop-window-guard.js')
importScripts('maintenance.js')

const {
  createDesktopWindowGuard,
  DESKTOP_APP_STATUS_MESSAGE,
  DESKTOP_APP_WINDOW_MESSAGE,
} = globalThis.NoirvaDesktopWindowGuard
const {
  createMaintenanceService,
  MAINTENANCE_MESSAGE,
} = globalThis.NoirvaMaintenance

const DEFAULTS = { enabled: true }

const desktopWindowGuard = createDesktopWindowGuard({
  tabs: chrome.tabs,
  windows: chrome.windows,
  sessionStorage: chrome.storage.session,
})
const maintenanceService = createMaintenanceService({
  browsingData: chrome.browsingData,
})

chrome.windows.onCreated.addListener((createdWindow) => {
  desktopWindowGuard.handleWindowCreated(createdWindow).catch((error) => {
    console.error('[Noirva] failed to handle the Chrome reopen window:', error)
  })
})

chrome.windows.onRemoved.addListener((windowId) => {
  desktopWindowGuard.handleWindowRemoved(windowId).catch((error) => {
    console.error('[Noirva] failed to clear the desktop app window:', error)
  })
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    chrome.storage.sync.set({ ...DEFAULTS, ...cfg })
  })
})

async function getStatus() {
  const cfg = await chrome.storage.sync.get(DEFAULTS)
  const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets()
  return {
    enabled: cfg.enabled !== false && rulesets.includes('youtube_ads'),
    version: chrome.runtime.getManifest().version,
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === MAINTENANCE_MESSAGE) {
    maintenanceService
      .clear(msg.action)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (msg?.type === DESKTOP_APP_WINDOW_MESSAGE) {
    desktopWindowGuard
      .registerAppWindow(sender)
      .then((registered) => sendResponse({ registered }))
      .catch((error) => sendResponse({ registered: false, error: String(error) }))
    return true
  }

  if (msg?.type === DESKTOP_APP_STATUS_MESSAGE) {
    desktopWindowGuard
      .isAppWindowSender(sender)
      .then((active) => sendResponse({ active }))
      .catch((error) => sendResponse({ active: false, error: String(error) }))
    return true
  }

  if (msg?.type === 'GET_STATUS') {
    getStatus()
      .then(sendResponse)
      .catch((error) => sendResponse({ enabled: false, error: String(error) }))
    return true
  }

  if (msg?.type === 'SET_ENABLED') {
    ;(async () => {
      const update = msg.enabled
        ? { enableRulesetIds: ['youtube_ads'], disableRulesetIds: [] }
        : { enableRulesetIds: [], disableRulesetIds: ['youtube_ads'] }
      try {
        await chrome.declarativeNetRequest.updateEnabledRulesets(update)
        await chrome.storage.sync.set({ enabled: Boolean(msg.enabled) })
        sendResponse({ ok: true, ...(await getStatus()) })
      } catch (error) {
        sendResponse({ ok: false, enabled: false, error: String(error) })
      }
    })()
    return true
  }
  return false
})
