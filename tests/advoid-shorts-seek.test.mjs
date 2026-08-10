import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const KT_PATH = fileURLToPath(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url),
)

function extractShortsSeekScript() {
  const source = readFileSync(KT_PATH, 'utf8')
  const match = source.match(/private const val SHORTS_SEEK_SCRIPT = """([\s\S]*?)"""/)
  assert.ok(match, 'SHORTS_SEEK_SCRIPT not found in MainActivity.kt')
  return match[1].replace(/\r\n/g, '\n')
}

const SHORTS_SEEK_SCRIPT = extractShortsSeekScript()

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.parentNode = null
    this.id = ''
    this._listeners = new Map()
  }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }
  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
    this.parentNode = null
  }
  setAttribute(name, value) {
    this[name] = value
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(listener)
  }
  fire(type) {
    const event = { type, stopPropagation() {} }
    for (const listener of this._listeners.get(type) || []) listener.call(this, event)
  }
}

class FakeVideo extends FakeElement {
  constructor({ duration = 30, currentTime = 0, paused = false, ended = false, rect } = {}) {
    super('video')
    this.duration = duration
    this.currentTime = currentTime
    this.paused = paused
    this.ended = ended
    this.rect = rect || { left: 0, top: 0, right: 390, bottom: 800 }
  }
  getBoundingClientRect() {
    return this.rect
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement('html')
    this.body = new FakeElement('body')
    this.documentElement.appendChild(this.body)
    this.activeElement = null
    this.videos = []
    this._listeners = new Map()
  }
  createElement(tag) {
    return new FakeElement(tag)
  }
  getElementById(id) {
    const walk = (node) => {
      if (node.id === id) return node
      for (const child of node.children) {
        const match = walk(child)
        if (match) return match
      }
      return null
    }
    return walk(this.documentElement)
  }
  querySelectorAll(selector) {
    return selector === 'video' ? this.videos : []
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(listener)
  }
  fire(type) {
    for (const listener of this._listeners.get(type) || []) listener({ type })
  }
}

class FakeMutationObserver {
  constructor(listener) {
    this.listener = listener
  }
  observe() {}
}

function makeEnv(pathname = '/shorts/abc') {
  const document = new FakeDocument()
  const location = { pathname }
  const windowListeners = new Map()
  const sandbox = {
    document,
    location,
    innerWidth: 390,
    innerHeight: 800,
    MutationObserver: FakeMutationObserver,
    console,
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, [])
      windowListeners.get(type).push(listener)
    },
  }
  sandbox.window = sandbox
  const context = vm.createContext(sandbox)
  return {
    addVideo(options) {
      const video = new FakeVideo(options)
      document.videos.push(video)
      return video
    },
    control: () => document.getElementById('advoid-shorts-seek'),
    navigate: (nextPathname) => {
      location.pathname = nextPathname
    },
    run: () => vm.runInContext(SHORTS_SEEK_SCRIPT, context),
    sync: () => vm.runInContext('window._advoidSyncShortsSeek();', context),
  }
}

describe('AdVoid Shorts seek control', () => {
  it('mirrors the active Short duration and current time', () => {
    const env = makeEnv()
    env.addVideo({ duration: 42, currentTime: 7 })
    env.run()

    assert.ok(env.control())
    assert.equal(env.control().type, 'range')
    assert.equal(env.control().max, '42')
    assert.equal(env.control().value, '7')
    assert.equal(env.control()['aria-label'], 'Seek Short')
  })

  it('seeks the active video when the range is dragged', () => {
    const env = makeEnv()
    const video = env.addVideo({ duration: 60, currentTime: 5 })
    env.run()

    env.control().value = '31.5'
    env.control().fire('input')
    assert.equal(video.currentTime, 31.5)
  })

  it('prefers the playing visible reel over a paused neighbour', () => {
    const env = makeEnv()
    env.addVideo({ duration: 10, currentTime: 2, paused: true })
    env.addVideo({ duration: 90, currentTime: 44, paused: false })
    env.run()

    assert.equal(env.control().max, '90')
    assert.equal(env.control().value, '44')
  })

  it('updates on playback and removes itself outside Shorts', () => {
    const env = makeEnv()
    const video = env.addVideo({ duration: 30, currentTime: 3 })
    env.run()

    video.currentTime = 12
    env.sync()
    assert.equal(env.control().value, '12')

    env.navigate('/watch')
    env.run()
    assert.equal(env.control(), null)
  })

  it('resumes progress sync after a drag and never carries stale time to the next reel', () => {
    const env = makeEnv()
    const first = env.addVideo({ duration: 30, currentTime: 3, paused: false })
    const second = env.addVideo({ duration: 80, currentTime: 50, paused: true })
    env.run()

    env.control().fire('touchstart')
    first.currentTime = 9
    env.sync()
    assert.equal(env.control().value, '3', 'playback must not fight the thumb mid-drag')

    env.control().fire('touchend')
    assert.equal(env.control().value, '9', 'progress resumes after the drag finishes')

    first.paused = true
    second.paused = false
    env.control().fire('pointerdown')
    env.sync()
    assert.equal(env.control().max, '80')
    assert.equal(env.control().value, '50', 'a new reel always replaces the old thumb value')
  })
})
