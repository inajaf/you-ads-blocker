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

function runScript({
  pathname,
  search = '',
  playerResponse,
  playerData = null,
  fetchedResponse,
  fetchImpl,
}) {
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
    addEventListener() {},
    getElementById(id) {
      return elements.get(id) || null
    },
    querySelector(selector) {
      if (selector === '.html5-video-player' && playerData) {
        return { getVideoData: () => playerData }
      }
      return null
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
    setTimeout: () => 0,
    setInterval: () => 0,
  })
  const rerun = () => vm.runInContext(liveChatScript, context)
  rerun()
  return {
    document,
    window,
    location,
    rerun,
    setPlayerData(nextPlayerData) { playerData = nextPlayerData },
  }
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

  it('uses the current YouTube player state when route globals are stale', () => {
    const { document } = runScript({
      pathname: '/@SkyNews/live',
      playerResponse: liveResponse({
        id: 'previous-video', isLive: false, isLiveContent: false, isLiveNow: false,
      }),
      playerData: { video_id: 'current-live-id', isLive: true },
    })

    assert.ok(document.getElementById('advoid-live-chat-btn'))
  })

  it('keeps an open chat panel mounted during periodic live-state sync', () => {
    const env = runScript({
      pathname: '/watch',
      search: '?v=current-live-id',
      playerResponse: liveResponse({
        id: 'current-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
      }),
      playerData: { video_id: 'current-live-id', isLive: true },
    })

    env.document.getElementById('advoid-live-chat-btn').click()
    assert.ok(env.document.getElementById('advoid-live-chat-panel'))

    env.window._advoidSyncLiveChat()

    assert.ok(env.document.getElementById('advoid-live-chat-panel'))
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

  it('accepts a current video response requested just before the SPA URL changes', async () => {
    let resolvePlayerFetch
    const playerFetch = new Promise((resolve) => { resolvePlayerFetch = resolve })
    const previousResponse = liveResponse({
      id: 'previous-video', isLive: false, isLiveContent: false, isLiveNow: false,
    })
    const currentResponse = liveResponse({
      id: 'current-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const env = runScript({
      pathname: '/watch',
      search: '?v=previous-video',
      playerResponse: previousResponse,
      playerData: { video_id: 'previous-video', isLive: false },
      fetchImpl: () => playerFetch,
    })

    const pendingFetch = env.window.fetch('/youtubei/v1/player')
    env.location.search = '?v=current-live-id'
    env.setPlayerData({ video_id: 'current-live-id', isLive: true })
    env.rerun()

    resolvePlayerFetch({
      clone: () => ({ text: async () => JSON.stringify(currentResponse) }),
    })
    await pendingFetch
    await Promise.all(env.window._advoidFetchPromises || [])

    assert.ok(env.document.getElementById('advoid-live-chat-btn'))
    assert.equal(env.window._advoidLiveChatShared.videoId, 'current-live-id')
  })

  it('carries a fast next-video response across one subsequent route change', async () => {
    const previousResponse = liveResponse({
      id: 'previous-video', isLive: false, isLiveContent: false, isLiveNow: false,
    })
    const currentResponse = liveResponse({
      id: 'current-live-id', isLive: true, isLiveContent: true, isLiveNow: true,
    })
    const env = runScript({
      pathname: '/watch',
      search: '?v=previous-video',
      playerResponse: previousResponse,
      playerData: { video_id: 'previous-video', isLive: false },
      fetchedResponse: currentResponse,
    })

    await env.window.fetch('/youtubei/v1/player')
    await Promise.all(env.window._advoidFetchPromises || [])
    assert.equal(env.window._advoidLiveChatShared.videoId, 'current-live-id')

    env.location.search = '?v=current-live-id'
    env.setPlayerData({ video_id: 'current-live-id' })
    env.rerun()

    assert.ok(env.document.getElementById('advoid-live-chat-btn'))
    assert.equal(env.window._advoidLiveChatShared.candidate.carried, true)
  })
})
