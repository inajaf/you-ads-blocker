import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const guardSource = fs.readFileSync(
  new URL('../extension/desktop-window-guard.js', import.meta.url),
  'utf8',
)
const guardContext = vm.createContext({ URL, setTimeout })
vm.runInContext(guardSource, guardContext)
const {
  createDesktopWindowGuard,
  DESKTOP_APP_STATUS_MESSAGE,
  DESKTOP_APP_WINDOW_MESSAGE,
  isAllowedDesktopAppTabUrl,
  isTrustedDesktopAppEntryUrl,
} = guardContext.NoirvaDesktopWindowGuard

const STORAGE_KEY = 'noirva.desktopAppWindowId'

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function createFakes(initialWindows = [], initialTabs = []) {
  const windowState = new Map(initialWindows.map((window) => [window.id, { ...window }]))
  const tabState = new Map(initialTabs.map((tab) => [tab.id, { ...tab }]))
  const storageState = {}
  const removed = []
  const updated = []

  return {
    removed,
    storageState,
    tabs: {
      async get(id) {
        const tab = tabState.get(id)
        if (!tab) throw new Error(`No tab with id: ${id}`)
        return { ...tab }
      },
    },
    updated,
    windows: {
      async get(id) {
        const window = windowState.get(id)
        if (!window) throw new Error(`No window with id: ${id}`)
        return { ...window }
      },
      async remove(id) {
        if (!windowState.delete(id)) throw new Error(`No window with id: ${id}`)
        removed.push(id)
      },
      async update(id, changes) {
        const window = windowState.get(id)
        if (!window) throw new Error(`No window with id: ${id}`)
        Object.assign(window, changes)
        updated.push([id, changes])
        return { ...window }
      },
    },
    sessionStorage: {
      async get(key) {
        return { [key]: storageState[key] }
      },
      async remove(key) {
        delete storageState[key]
      },
      async set(changes) {
        Object.assign(storageState, changes)
      },
    },
  }
}

function createGuard(fakes) {
  return createDesktopWindowGuard({
    windows: fakes.windows,
    tabs: fakes.tabs,
    sessionStorage: fakes.sessionStorage,
    reopenDelayMs: 0,
    setTimeoutFn: (callback) => callback(),
  })
}

describe('Noirva desktop window guard', () => {
  it('uses an explicit message shared by the content script and worker', () => {
    assert.equal(DESKTOP_APP_WINDOW_MESSAGE, 'REGISTER_DESKTOP_APP_WINDOW')
    assert.equal(DESKTOP_APP_STATUS_MESSAGE, 'GET_DESKTOP_APP_WINDOW_STATUS')

    const contentSource = fs.readFileSync(
      new URL('../extension/content.js', import.meta.url),
      'utf8',
    )
    const backgroundSource = fs.readFileSync(
      new URL('../extension/background.js', import.meta.url),
      'utf8',
    )
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
    )

    assert.match(contentSource, /REGISTER_DESKTOP_APP_WINDOW/)
    assert.match(contentSource, /response\?\.registered/)
    assert.match(contentSource, /registration timed out/)
    assert.match(contentSource, /DESKTOP_APP_HEARTBEAT_MS = 15_000/)
    assert.match(contentSource, /desktopWindowRegistrationPending/)
    assert.match(contentSource, /desktopWindowLastConfirmedAt = Date\.now\(\)/)
    assert.match(
      contentSource,
      /Date\.now\(\) - desktopWindowLastConfirmedAt < DESKTOP_APP_HEARTBEAT_MS/,
    )
    assert.match(backgroundSource, /DESKTOP_APP_WINDOW_MESSAGE/)
    assert.match(backgroundSource, /DESKTOP_APP_STATUS_MESSAGE/)
    assert.equal(manifest.background.type, undefined)
    assert.match(backgroundSource, /importScripts\('desktop-window-guard\.js'\)/)
  })

  it('adopts a new YouTube Studio tab in the registered app window', async () => {
    const fakes = createFakes([
      { id: 7, type: 'normal' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/' },
      { id: 71, windowId: 7, url: 'https://studio.youtube.com/channel/example' },
    ])
    fakes.storageState[STORAGE_KEY] = { windowId: 7, tabId: 70 }
    const guard = createGuard(fakes)

    assert.equal(
      await guard.isAppWindowSender({
        frameId: 0,
        url: 'https://studio.youtube.com/channel/example',
        tab: { id: 71, windowId: 7 },
      }),
      true,
    )
    assert.deepEqual(plain(fakes.storageState[STORAGE_KEY]), { windowId: 7, tabId: 71 })
  })

  it('inherits app mode in a Studio popup without replacing the primary registration', async () => {
    const fakes = createFakes([
      { id: 7, type: 'normal' },
      { id: 8, type: 'popup' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/' },
      {
        id: 80,
        windowId: 8,
        openerTabId: 70,
        url: 'https://studio.youtube.com/channel/example/videos/upload',
      },
    ])
    fakes.storageState[STORAGE_KEY] = { windowId: 7, tabId: 70 }
    const guard = createGuard(fakes)
    const popupSender = {
      frameId: 0,
      url: 'https://studio.youtube.com/channel/example/videos/upload',
      tab: { id: 80, windowId: 8 },
    }

    assert.equal(await guard.isAppWindowSender(popupSender), true)
    assert.equal(await guard.registerAppWindow(popupSender), true)
    assert.deepEqual(plain(fakes.storageState[STORAGE_KEY]), { windowId: 7, tabId: 70 })
  })

  it('rejects an unrelated normal YouTube window', async () => {
    const fakes = createFakes([
      { id: 7, type: 'normal' },
      { id: 8, type: 'normal' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/' },
      { id: 80, windowId: 8, url: 'https://studio.youtube.com/channel/example' },
    ])
    fakes.storageState[STORAGE_KEY] = { windowId: 7, tabId: 70 }
    const guard = createGuard(fakes)
    const unrelatedSender = {
      frameId: 0,
      url: 'https://studio.youtube.com/channel/example',
      tab: { id: 80, windowId: 8 },
    }

    assert.equal(
      await guard.isAppWindowSender(unrelatedSender),
      false,
    )
    assert.equal(await guard.registerAppWindow(unrelatedSender), false)
    assert.deepEqual(plain(fakes.storageState[STORAGE_KEY]), { windowId: 7, tabId: 70 })
  })

  it('recognizes only the trusted HTTPS YouTube app entry marker', () => {
    assert.equal(isTrustedDesktopAppEntryUrl('https://www.youtube.com/?tube_app=1'), true)
    assert.equal(isTrustedDesktopAppEntryUrl('https://m.youtube.com/?tube_app=1'), true)
    assert.equal(isTrustedDesktopAppEntryUrl('https://www.youtube.com/watch?v=abc'), false)
    assert.equal(isTrustedDesktopAppEntryUrl('http://www.youtube.com/?tube_app=1'), false)
    assert.equal(isTrustedDesktopAppEntryUrl('https://youtube.com.attacker.test/?tube_app=1'), false)
    assert.equal(isAllowedDesktopAppTabUrl('https://www.youtube.com/watch?v=abc'), true)
    assert.equal(isAllowedDesktopAppTabUrl('https://example.com/'), false)
  })

  it('registers a trusted top-level YouTube content script regardless of marker or window type', async () => {
    const fakes = createFakes([
      { id: 7, type: 'app' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/?tube_app=1' },
    ])
    const guard = createGuard(fakes)

    assert.equal(
      await guard.registerAppWindow({
        frameId: 0,
        url: 'https://www.youtube.com/',
        tab: { id: 70, windowId: 7 },
      }),
      true,
    )
    assert.deepEqual(plain(fakes.storageState[STORAGE_KEY]), { windowId: 7, tabId: 70 })

    assert.equal(
      await guard.registerAppWindow({
        frameId: 1,
        url: 'https://www.youtube.com/?tube_app=1',
        tab: { id: 70, windowId: 7 },
      }),
      false,
    )
    assert.equal(
      await guard.registerAppWindow({
        frameId: 0,
        url: 'https://example.com/?tube_app=1',
        tab: { id: 70, windowId: 7 },
      }),
      false,
    )
  })

  it('rejects registration when the live tab no longer belongs to the sender window', async () => {
    const fakes = createFakes([
      { id: 7, type: 'app' },
    ], [
      { id: 70, windowId: 8, url: 'https://www.youtube.com/' },
    ])
    const guard = createGuard(fakes)

    assert.equal(
      await guard.registerAppWindow({
        frameId: 0,
        url: 'https://www.youtube.com/',
        tab: { id: 70, windowId: 7 },
      }),
      false,
    )
    assert.equal(fakes.storageState[STORAGE_KEY], undefined)
  })

  it('closes a normal Dock-reopen window and focuses the Noirva app window', async () => {
    const fakes = createFakes([
      { id: 7, type: 'app', focused: false },
      { id: 9, type: 'normal', focused: true },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/watch?v=abc' },
    ])
    const guard = createGuard(fakes)
    fakes.storageState[STORAGE_KEY] = { windowId: 7, tabId: 70 }

    assert.equal(await guard.handleWindowCreated({ id: 9, type: 'normal' }), true)
    assert.deepEqual(fakes.removed, [9])
    assert.deepEqual(plain(fakes.updated), [[7, { focused: true }]])
  })

  it('restores a minimized Noirva app window while closing the Dock-reopen window', async () => {
    const fakes = createFakes([
      { id: 7, type: 'app', state: 'minimized', focused: false },
      { id: 9, type: 'normal', state: 'normal', focused: true },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/' },
    ])
    const guard = createGuard(fakes)
    fakes.storageState[STORAGE_KEY] = { windowId: 7, tabId: 70 }

    assert.equal(await guard.handleWindowCreated({ id: 9, type: 'normal' }), true)
    assert.deepEqual(fakes.removed, [9])
    assert.deepEqual(plain(fakes.updated), [[7, { focused: true, state: 'normal' }]])
  })

  it('keeps unrelated popup windows and normal windows without an app session', async () => {
    const fakes = createFakes([
      { id: 9, type: 'normal' },
      { id: 10, type: 'popup' },
    ])
    const guard = createGuard(fakes)

    assert.equal(await guard.handleWindowCreated({ id: 9, type: 'normal' }), false)
    assert.equal(await guard.handleWindowCreated({ id: 10, type: 'popup' }), false)
    assert.deepEqual(fakes.removed, [])
  })

  it('survives service-worker restarts through session storage', async () => {
    const fakes = createFakes([
      { id: 7, type: 'app' },
      { id: 9, type: 'normal' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/?tube_app=1' },
    ])
    await createGuard(fakes).registerAppWindow({
      frameId: 0,
      url: 'https://www.youtube.com/?tube_app=1',
      tab: { id: 70, windowId: 7 },
    })

    const restartedGuard = createGuard(fakes)
    assert.equal(await restartedGuard.handleWindowCreated({ id: 9, type: 'normal' }), true)
    assert.deepEqual(fakes.removed, [9])
  })

  it('clears stale or closed app-window registrations', async () => {
    const staleFakes = createFakes([{ id: 9, type: 'normal' }])
    staleFakes.storageState[STORAGE_KEY] = { windowId: 404, tabId: 405 }
    const staleGuard = createGuard(staleFakes)

    assert.equal(await staleGuard.handleWindowCreated({ id: 9, type: 'normal' }), false)
    assert.equal(staleFakes.storageState[STORAGE_KEY], undefined)

    const closedFakes = createFakes([
      { id: 7, type: 'app' },
    ], [
      { id: 70, windowId: 7, url: 'https://www.youtube.com/?tube_app=1' },
    ])
    const closedGuard = createGuard(closedFakes)
    await closedGuard.registerAppWindow({
      frameId: 0,
      url: 'https://www.youtube.com/?tube_app=1',
      tab: { id: 70, windowId: 7 },
    })
    assert.equal(await closedGuard.handleWindowRemoved(7), true)
    assert.equal(closedFakes.storageState[STORAGE_KEY], undefined)
  })
})
