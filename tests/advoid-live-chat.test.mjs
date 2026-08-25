import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const mainActivity = readFileSync(
  fileURLToPath(new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url)),
  'utf8',
)
const match = mainActivity.match(/private const val LIVE_CHAT_SCRIPT = """([\s\S]*?)"""/)
assert.ok(match, 'LIVE_CHAT_SCRIPT not found in MainActivity.kt')
const liveChatScript = match[1]

function runScript({ pathname, search = '', playerResponse, fetchedResponse, fetchImpl }) {
  const elements = new Map()
  const parent = {
    appendChild(element) {
      element.parent = this
      if (element.id) elements.set(element.id, element)
      return element
    },
  }
  const document = {
    body: parent,
    head: parent,
    documentElement: parent,
    getElementById(id) {
      return elements.get(id) || null
    },
    createElement() {
      const listeners = new Map()
      return {
        id: '',
        children: [],
        appendChild(child) { this.children.push(child); return child },
        setAttribute() {},
        addEventListener(type, listener) { listeners.set(type, listener) },
        click() { listeners.get('click')?.() },
        remove() { if (this.id) elements.delete(this.id) },
      }
    },
  }
  const window = {
    ytInitialPlayerResponse: playerResponse,
    fetch: fetchImpl || function fetch() {
      return Promise.resolve({
        clone: () => ({ text: async () => JSON.stringify(fetchedResponse || {}) }),
      })
    },
  }
  const location = { pathname, search }
  const context = vm.createContext({
    window,
    document,
    location,
    URLSearchParams,
    encodeURIComponent,
  })
  const rerun = () => vm.runInContext(liveChatScript, context)
  rerun()
  return { document, window, location, rerun }
}

function liveResponse({ id = 'live-id', isLive, isLiveContent, isLiveNow }) {
  return {
    videoDetails: { videoId: id, isLive, isLiveContent },
    microformat: {
      playerMicroformatRenderer: {
        liveBroadcastDetails: { isLiveNow },
      },
    },
  }
}

describe('Android live chat affordance', () => {
  it('appears on a current channel /live route', () => {
    const { document } = runScript({
      pathname: '/@SkyNews/live',
      playerResponse: liveResponse({ isLive: true, isLiveContent: true, isLiveNow: true }),
    })
    assert.equal(document.getElementById('advoid-live-chat-btn')?.textContent, 'Live chat')
  })

  it('appears on a current /watch live stream', () => {
    const { document } = runScript({
      pathname: '/watch',
      search: '?v=live-id',
      playerResponse: liveResponse({ isLive: true, isLiveContent: true, isLiveNow: true }),
    })
    assert.ok(document.getElementById('advoid-live-chat-btn'))
  })

  it('does not treat a completed live recording as currently live', () => {
    const { document } = runScript({
      pathname: '/watch',
      search: '?v=live-id',
      playerResponse: liveResponse({ isLiveContent: true, isLiveNow: false }),
    })
    assert.equal(document.getElementById('advoid-live-chat-btn'), null)
  })

  it('uses the fetch-tracked video after an SPA transition to /live', async () => {
    const staleResponse = liveResponse({
      id: 'previous-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const currentResponse = liveResponse({
      id: 'current-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const { document, window } = runScript({
      pathname: '/@SkyNews/live',
      playerResponse: staleResponse,
      fetchedResponse: currentResponse,
    })

    await window.fetch('/youtubei/v1/player')
    await Promise.all(window._advoidFetchPromises || [])

    const button = document.getElementById('advoid-live-chat-btn')
    assert.ok(button)
    button.click()
    assert.match(
      document.getElementById('advoid-live-chat-panel')?.children[1]?.src,
      /[?&]v=current-live-id(?:&|$)/,
    )
  })

  it('ignores a delayed player response from the previous SPA route', async () => {
    let resolveOldFetch
    const oldFetch = new Promise((resolve) => { resolveOldFetch = resolve })
    const previousResponse = liveResponse({
      id: 'previous-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const currentResponse = liveResponse({
      id: 'current-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const { document, window, location, rerun } = runScript({
      pathname: '/watch',
      search: '?v=previous-live-id',
      playerResponse: previousResponse,
      fetchImpl: () => oldFetch,
    })

    const pendingOldFetch = window.fetch('/youtubei/v1/player')
    location.pathname = '/@SkyNews/live'
    location.search = ''
    window.ytInitialPlayerResponse = currentResponse
    rerun()

    resolveOldFetch({
      clone: () => ({ text: async () => JSON.stringify(previousResponse) }),
    })
    await pendingOldFetch
    await Promise.all(window._advoidFetchPromises || [])

    const button = document.getElementById('advoid-live-chat-btn')
    assert.ok(button)
    button.click()
    assert.match(
      document.getElementById('advoid-live-chat-panel')?.children[1]?.src,
      /[?&]v=current-live-id(?:&|$)/,
    )
    assert.equal(window._advoidLiveChatShared.videoId, null)
  })
})
