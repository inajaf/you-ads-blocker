;(function installDesktopWindowGuard(globalScope) {
  const DESKTOP_APP_WINDOW_MESSAGE = 'REGISTER_DESKTOP_APP_WINDOW'
  const DESKTOP_APP_STATUS_MESSAGE = 'GET_DESKTOP_APP_WINDOW_STATUS'

  const APP_WINDOW_STORAGE_KEY = 'noirva.desktopAppWindowId'
  const DEFAULT_REOPEN_DELAY_MS = 0

  function isWindowId(value) {
    return Number.isInteger(value) && value >= 0
  }

  function parseTrustedYouTubeUrl(value) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:') return null
      if (url.hostname !== 'youtube.com' && !url.hostname.endsWith('.youtube.com')) {
        return null
      }
      return url
    } catch {
      return null
    }
  }

  function isTrustedDesktopAppEntryUrl(value) {
    return parseTrustedYouTubeUrl(value)?.searchParams.get('tube_app') === '1'
  }

  function isAllowedDesktopAppTabUrl(value) {
    return parseTrustedYouTubeUrl(value) !== null
  }

  function createDesktopWindowGuard({
    tabs,
    windows,
    sessionStorage,
    reopenDelayMs = DEFAULT_REOPEN_DELAY_MS,
    setTimeoutFn = setTimeout,
  }) {
    async function readAppWindowRegistration() {
      const state = await sessionStorage.get(APP_WINDOW_STORAGE_KEY)
      return state[APP_WINDOW_STORAGE_KEY]
    }

    async function clearAppWindowRegistration() {
      await sessionStorage.remove(APP_WINDOW_STORAGE_KEY)
    }

    async function getLiveAppWindow() {
      const registration = await readAppWindowRegistration()
      const appWindowId = registration?.windowId
      const appTabId = registration?.tabId
      if (!isWindowId(appWindowId) || !isWindowId(appTabId)) return null

      try {
        const [appWindow, appTab] = await Promise.all([
          windows.get(appWindowId),
          tabs.get(appTabId),
        ])
        if (appTab.windowId === appWindowId && isAllowedDesktopAppTabUrl(appTab.url)) {
          return appWindow
        }
      } catch {
        // The stored window was closed while the extension worker was asleep.
      }

      await clearAppWindowRegistration()
      return null
    }

    async function registerAppWindow(sender) {
      const appWindowId = sender?.tab?.windowId
      const appTabId = sender?.tab?.id
      const senderUrl = sender?.url || sender?.tab?.url
      if (
        sender?.frameId !== 0 ||
        !isWindowId(appWindowId) ||
        !isWindowId(appTabId) ||
        !isAllowedDesktopAppTabUrl(senderUrl)
      ) {
        return false
      }

      try {
        const [appWindow, appTab] = await Promise.all([
          windows.get(appWindowId),
          tabs.get(appTabId),
        ])
        if (
          appWindow.id !== appWindowId ||
          appTab.windowId !== appWindowId ||
          !isAllowedDesktopAppTabUrl(appTab.url)
        ) {
          return false
        }

        const registration = await readAppWindowRegistration()
        if (registration && registration.windowId !== appWindowId) {
          try {
            await windows.get(registration.windowId)

            const isChildSurface =
              appTab.openerTabId === registration.tabId || appWindow.type === 'popup'

            // Studio and upload can open a child popup. Let it inherit app mode,
            // but keep the primary Noirva window registered for reopen handling.
            return isChildSurface
          } catch {
            // The previous primary window is gone, so this one may replace it.
          }
        }

        await sessionStorage.set({
          [APP_WINDOW_STORAGE_KEY]: { windowId: appWindowId, tabId: appTabId },
        })
        return true
      } catch {
        return false
      }
    }

    async function isAppWindowSender(sender) {
      const senderWindowId = sender?.tab?.windowId
      const senderTabId = sender?.tab?.id
      const senderUrl = sender?.url || sender?.tab?.url
      if (
        sender?.frameId !== 0 ||
        !isWindowId(senderWindowId) ||
        !isWindowId(senderTabId) ||
        !isAllowedDesktopAppTabUrl(senderUrl)
      ) {
        return false
      }

      const registration = await readAppWindowRegistration()
      if (!registration) {
        return false
      }

      let registeredWindow
      try {
        registeredWindow = await windows.get(registration.windowId)
      } catch {
        // The registered app window is confirmed gone, so drop the stale record
        // and let a future window claim the primary slot. Only the registered
        // window lookup clears here; unrelated sender lookup failures below do
        // not, so a transient error can't wipe a live registration.
        await clearAppWindowRegistration()
        return false
      }

      try {
        const [senderWindow, tab] = await Promise.all([
          windows.get(senderWindowId),
          tabs.get(senderTabId),
        ])
        if (
          !registeredWindow ||
          tab.windowId !== senderWindowId ||
          !isAllowedDesktopAppTabUrl(tab.url)
        ) {
          return false
        }

        if (registration.windowId === senderWindowId) {
          if (registration.tabId !== senderTabId) {
            await sessionStorage.set({
              [APP_WINDOW_STORAGE_KEY]: { windowId: senderWindowId, tabId: senderTabId },
            })
          }
          return true
        }

        return tab.openerTabId === registration.tabId || senderWindow.type === 'popup'
      } catch {
        return false
      }
    }

    async function handleWindowCreated(createdWindow) {
      if (createdWindow?.type !== 'normal' || !isWindowId(createdWindow.id)) return false

      const appWindow = await getLiveAppWindow()
      if (!appWindow || appWindow.id === createdWindow.id) return false

      if (reopenDelayMs > 0) {
        await new Promise((resolve) => setTimeoutFn(resolve, reopenDelayMs))
      }

      try {
        const [liveAppWindow, liveCreatedWindow] = await Promise.all([
          getLiveAppWindow(),
          windows.get(createdWindow.id),
        ])
        if (!liveAppWindow || liveCreatedWindow.type !== 'normal') return false

        await windows.remove(createdWindow.id)
        const focusChanges =
          liveAppWindow.state === 'minimized'
            ? { focused: true, state: 'normal' }
            : { focused: true }
        await windows.update(liveAppWindow.id, focusChanges)
        return true
      } catch {
        return false
      }
    }

    async function handleWindowRemoved(windowId) {
      if (!isWindowId(windowId)) return false
      const registration = await readAppWindowRegistration()
      if (registration?.windowId !== windowId) return false
      await clearAppWindowRegistration()
      return true
    }

    return {
      getLiveAppWindow,
      handleWindowCreated,
      handleWindowRemoved,
      isAppWindowSender,
      registerAppWindow,
    }
  }

  globalScope.NoirvaDesktopWindowGuard = Object.freeze({
    createDesktopWindowGuard,
    DESKTOP_APP_STATUS_MESSAGE,
    DESKTOP_APP_WINDOW_MESSAGE,
    isAllowedDesktopAppTabUrl,
    isTrustedDesktopAppEntryUrl,
  })
})(globalThis)
