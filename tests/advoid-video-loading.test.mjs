import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// The loading overlay is an injected script living inside
// MainActivity.kt (VIDEO_WATCH_SCRIPT_TEMPLATE). It is a self-contained
// IIFE, so the test extracts it verbatim, substitutes the logo placeholder
// with a stub, and runs it against a minimal DOM shim — no Android runtime
// needed. This is what gates the cold-start/loading-vs-pause behavior the
// task cares about.

const KT_PATH = fileURLToPath(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url),
)
const LOGO_PLACEHOLDER = '__ADVOID_LOGO_DATA_URI__'

function extractWatchScript() {
  const source = readFileSync(KT_PATH, 'utf8')
  const match = source.match(
    /private const val VIDEO_WATCH_SCRIPT_TEMPLATE = """([\s\S]*?)"""/,
  )
  assert.ok(match, 'VIDEO_WATCH_SCRIPT_TEMPLATE not found in MainActivity.kt')
  return match[1]
    .replace(/\r\n/g, '\n')
    .replaceAll(LOGO_PLACEHOLDER, 'data:image/png;base64,STUB')
}

const WATCH_SCRIPT = extractWatchScript()

// The overlay's look (dark plate, round emblem + orbit spinner) lives in STYLE_SCRIPT.
// It is injected as one <style> element, so the node tests assert the raw CSS
// contains the rules the acceptance criteria depend on.
function extractStyleScript() {
  const source = readFileSync(KT_PATH, 'utf8')
  const match = source.match(
    /private const val STYLE_SCRIPT = """([\s\S]*?)"""/,
  )
  assert.ok(match, 'STYLE_SCRIPT not found in MainActivity.kt')
  return match[1].replace(/\r\n/g, '\n')
}

const STYLE_CSS = extractStyleScript()

class FakeClassList {
  constructor() {
    this.tokens = new Set()
  }
  add(...tokens) {
    tokens.forEach((t) => this.tokens.add(t))
  }
  remove(...tokens) {
    tokens.forEach((t) => this.tokens.delete(t))
  }
  contains(token) {
    return this.tokens.has(token)
  }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.parentNode = null
    this.id = ''
    this.classList = new FakeClassList()
    this._listeners = new Map()
    this.innerHTML = ''
  }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  setAttribute(name, value) {
    this[name] = value
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child)
    if (child.parentNode === this) child.parentNode = null
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(fn)
  }
  fire(type) {
    for (const fn of this._listeners.get(type) || []) fn.call(this, { type })
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1))
    return this.tagName.toLowerCase() === selector.toLowerCase()
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.matches(selector)) return node
      node = node.parentNode
    }
    return null
  }
  querySelector(selector) {
    if (!selector.startsWith('#')) return null
    const wanted = selector.slice(1)
    const walk = (node) => {
      for (const child of node.children) {
        if (child.id === wanted) return child
        const hit = walk(child)
        if (hit) return hit
      }
      return null
    }
    return walk(this)
  }
}

class FakeVideo extends FakeElement {
  constructor(options = {}) {
    super('video')
    this.readyState = options.readyState ?? 0
    this.seeking = options.seeking ?? false
    this.paused = options.paused ?? true
    this.ended = options.ended ?? false
    this.currentTime = options.currentTime ?? 0
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement('html')
    this.head = new FakeElement('head')
    this._videos = []
  }
  createElement(tag) {
    if (tag.toLowerCase() === 'video') return new FakeVideo()
    return new FakeElement(tag)
  }
  querySelectorAll(selector) {
    if (selector === 'video') return this._videos
    if (selector === '.html5-video-player video') {
      return this._videos.filter((v) => v.closest('.html5-video-player'))
    }
    if (selector === '.html5-video-player.advoid-loading') {
      const players = new Set()
      for (const video of this._videos) {
        const player = video.closest('.html5-video-player')
        if (player?.classList.contains('advoid-loading')) players.add(player)
      }
      return [...players]
    }
    return []
  }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

function makeEnv(pathname = '/watch') {
  const document = new FakeDocument()
  const location = { pathname }
  const player = new FakeElement('div')
  player.classList.add('html5-video-player')
  const sandbox = {
    document,
    location,
    MutationObserver: FakeMutationObserver,
    setTimeout,
    console,
  }
  sandbox.window = sandbox
  const context = vm.createContext(sandbox)
  const addVideo = (options = {}, inPlayer = true) => {
    const video = new FakeVideo(options)
    if (inPlayer) player.appendChild(video)
    else document.documentElement.appendChild(video)
    document._videos.push(video)
    return video
  }
  return {
    player,
    addVideo,
    navigate: (nextPathname) => {
      location.pathname = nextPathname
    },
    sync: () => vm.runInContext('window._advoidSyncVideoState();', context),
    setup: () => vm.runInContext(WATCH_SCRIPT, context),
  }
}

describe('AdVoid loading overlay (VIDEO_WATCH_SCRIPT)', () => {
  it('shows the overlay while a fresh watch video is still loading', () => {
    const env = makeEnv()
    env.addVideo({ readyState: 0 })
    env.setup()

    assert.equal(env.player.classList.contains('advoid-loading'), true)
    const overlay = env.player.querySelector('#advoid-loading-overlay')
    assert.ok(overlay, 'overlay element was created')
    // Built with DOM APIs, never innerHTML: m.youtube.com enforces a Trusted
    // Types policy that throws on innerHTML assignment, which used to kill the
    // overlay before the .advoid-loading class was added (grey button stayed).
    assert.equal(overlay.innerHTML, '')
    // Keep the round emblem and its orbit in one concentric wrapper.
    const [mark] = overlay.children
    assert.equal(mark.className, 'advoid-loading-mark')
    const [img, spinner] = mark.children
    assert.ok(img, 'logo <img> present')
    assert.equal(img.tagName, 'IMG')
    assert.ok(String(img.src).includes('data:image/png;base64,STUB'))
    assert.ok(!String(img.src).includes(LOGO_PLACEHOLDER), 'logo placeholder was substituted')
    assert.equal(spinner.className, 'advoid-spinner')
    assert.equal(spinner['aria-hidden'], 'true')
  })

  it('hides the overlay once the video can play', () => {
    const env = makeEnv()
    const video = env.addVideo({ readyState: 0 })
    env.setup()
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.fire('canplay')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('keeps the grey play button for an explicit pause (ready frame)', () => {
    const env = makeEnv()
    env.addVideo({ readyState: 3, paused: true })
    env.setup()

    assert.equal(env.player.classList.contains('advoid-loading'), false)
    assert.equal(env.player.querySelector('#advoid-loading-overlay'), null)
  })

  it('shows the overlay again when a loaded video reloads (emptied/loadstart)', () => {
    const env = makeEnv()
    const video = env.addVideo({ readyState: 3, paused: true })
    env.setup()
    assert.equal(env.player.classList.contains('advoid-loading'), false)

    video.fire('emptied')
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.fire('playing')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('suppresses the overlay during a seek, even on a stalled wait', () => {
    const env = makeEnv()
    const video = env.addVideo({ readyState: 3 })
    env.setup()

    video.seeking = true
    video.fire('seeking')
    video.fire('waiting')
    assert.equal(env.player.classList.contains('advoid-loading'), false)

    video.seeking = false
    video.fire('waiting')
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.fire('playing')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('never shows the overlay outside the watch page', () => {
    const env = makeEnv('/shorts/abc')
    const video = env.addVideo({ readyState: 0 })
    env.setup()

    assert.equal(env.player.classList.contains('advoid-loading'), false)
    video.fire('emptied')
    video.fire('loadstart')
    video.fire('waiting')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('ignores feed preview videos that live outside the main player', () => {
    const env = makeEnv()
    const preview = env.addVideo({ readyState: 0 }, false)
    env.setup()

    assert.equal(env.player.classList.contains('advoid-loading'), false)
    preview.fire('emptied')
    preview.fire('waiting')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('resyncs from readyState on SPA navigation or app resume', () => {
    const env = makeEnv()
    const video = env.addVideo({ readyState: 0 })
    env.setup()
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.readyState = 3
    env.sync()
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('clears a watch loading class when SPA navigation leaves /watch', () => {
    const env = makeEnv()
    env.addVideo({ readyState: 0 })
    env.setup()
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    env.navigate('/shorts/abc')
    env.sync()
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })

  it('keeps a waiting overlay until media time actually advances', () => {
    const env = makeEnv()
    const video = env.addVideo({ readyState: 3, paused: false, currentTime: 12 })
    env.setup()

    video.fire('waiting')
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.fire('timeupdate')
    assert.equal(env.player.classList.contains('advoid-loading'), true)

    video.currentTime = 12.25
    video.fire('timeupdate')
    assert.equal(env.player.classList.contains('advoid-loading'), false)
  })
})

describe('AdVoid loading overlay styles (STYLE_SCRIPT)', () => {
  it('keeps fullscreen top controls below Android transient system bars', () => {
    assert.match(STYLE_CSS, /:fullscreen \.player-controls-top/)
    assert.match(STYLE_CSS, /:-webkit-full-screen \.player-controls-top/)
    assert.match(STYLE_CSS, /top: max\(28px, env\(safe-area-inset-top\)\)/)
  })

  it('covers the whole player with a dark plate and fades in', () => {
    // The overlay stretches over the full player area so neither the grey
    // background nor the centre play button shows through while loading.
    assert.match(STYLE_CSS, /#advoid-loading-overlay/)
    assert.match(STYLE_CSS, /width: 100%; height: 100%/)
    // Dense navy-to-black radial plate keeps YouTube's own glyph out of view.
    assert.match(STYLE_CSS, /background: radial-gradient\(circle at center/)
    assert.match(STYLE_CSS, /rgba\(7,20,47,0\.88\)/)
    assert.match(STYLE_CSS, /pointer-events: none/)
    // Smooth fade-in on show (~0.2-0.3s).
    assert.match(STYLE_CSS, /animation: advoid-fade-in 0\.[23]\d*s/)
    assert.match(STYLE_CSS, /@keyframes advoid-fade-in/)
  })

  it('centres a round 88px emblem inside a compact 104px orbit', () => {
    assert.match(STYLE_CSS, /\.advoid-loading-mark/)
    assert.match(STYLE_CSS, /width: 104px; height: 104px/)
    assert.match(STYLE_CSS, /\.advoid-loading-mark > img/)
    assert.match(STYLE_CSS, /width: 88px; height: 88px/)
    assert.match(STYLE_CSS, /\.advoid-loading-mark > img[^}]*border-radius: 50%/s)
    assert.match(STYLE_CSS, /\.advoid-spinner/)
    assert.match(STYLE_CSS, /position: absolute/)
    assert.match(STYLE_CSS, /inset: 0/)
    assert.match(STYLE_CSS, /border-radius: 50%/)
    assert.match(STYLE_CSS, /border-top-color: #25D9FF/)
    assert.match(STYLE_CSS, /border-right-color: #F52A82/)
    assert.match(STYLE_CSS, /@keyframes advoid-logo-enter/)
    assert.match(STYLE_CSS, /@keyframes advoid-spin/)
  })
})
