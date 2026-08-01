import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../desktop/desktop-tab-open.js', import.meta.url),
  'utf8',
)

function createContext() {
  const dispatched = []
  const context = vm.createContext({
    URL,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type
        this.detail = options && options.detail
      }
    },
    dispatchEvent(event) {
      dispatched.push(event)
    },
    location: { href: 'https://www.youtube.com/' },
  })
  vm.runInContext(source, context)
  return { api: context.NoirvaDesktopTabOpen, dispatched }
}

function anchorWithHref(href) {
  return {
    tagName: 'A',
    hasAttribute(name) {
      return name === 'href'
    },
    getAttribute(name) {
      return name === 'href' ? href : null
    },
    parentNode: null,
  }
}

function clickEvent({ href, button = 0, modifiers = {}, targetTag = 'DIV' }) {
  const anchor = anchorWithHref(href)
  return {
    button,
    metaKey: Boolean(modifiers.metaKey),
    ctrlKey: Boolean(modifiers.ctrlKey),
    shiftKey: Boolean(modifiers.shiftKey),
    altKey: Boolean(modifiers.altKey),
    target: targetTag === 'A' ? anchor : { tagName: targetTag, parentNode: anchor },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  }
}

describe('AdVoid desktop video-click interceptor', () => {
  it('recognizes only trusted YouTube watch/shorts URLs', () => {
    const { api } = createContext()

    assert.equal(api.isVideoUrl('https://www.youtube.com/watch?v=abc'), true)
    assert.equal(api.isVideoUrl('https://m.youtube.com/watch?v=abc&list=PL1'), true)
    assert.equal(api.isVideoUrl('https://www.youtube.com/shorts/abc'), true)

    assert.equal(api.isVideoUrl('https://www.youtube.com/'), false)
    assert.equal(api.isVideoUrl('https://www.youtube.com/@channel'), false)
    assert.equal(api.isVideoUrl('https://example.com/watch?v=abc'), false)
    assert.equal(api.isVideoUrl('http://www.youtube.com/watch?v=abc'), false)

    assert.equal(api.isYouTubeUrl('https://www.youtube.com/'), true)
    assert.equal(api.isYouTubeUrl('https://youtube.com.attacker.test/'), false)
  })

  it('lets a plain single click on a video link navigate the current tab', () => {
    const { api, dispatched } = createContext()
    const event = clickEvent({ href: '/watch?v=video1' })

    api.handleClick(event)

    assert.equal(event.prevented, false)
    assert.equal(event.stopped, false)
    assert.equal(dispatched.length, 0)
  })

  it('opens a Cmd/Ctrl+click on a video link in a new tab', () => {
    const { api, dispatched } = createContext()
    const cmd = clickEvent({ href: '/watch?v=video1', modifiers: { metaKey: true } })
    const ctrl = clickEvent({ href: '/watch?v=video1', modifiers: { ctrlKey: true } })

    api.handleClick(cmd)
    api.handleClick(ctrl)

    assert.equal(cmd.prevented, true)
    assert.equal(cmd.stopped, true)
    assert.equal(ctrl.prevented, true)
    assert.equal(dispatched.length, 2)
    assert.equal(dispatched[0].type, api.OPEN_VIDEO_EVENT)
    assert.equal(dispatched[0].detail.url, 'https://www.youtube.com/watch?v=video1')
    assert.equal(dispatched[1].detail.url, 'https://www.youtube.com/watch?v=video1')
  })

  it('opens a Cmd+click on a nested element inside a video link in a new tab', () => {
    const { api, dispatched } = createContext()
    const event = clickEvent({
      href: 'https://www.youtube.com/watch?v=abc',
      modifiers: { metaKey: true },
    })

    api.handleClick(event)

    assert.equal(event.prevented, true)
    assert.equal(dispatched[0].detail.url, 'https://www.youtube.com/watch?v=abc')
  })

  it('ignores non-video links so normal navigation still works', () => {
    const { api, dispatched } = createContext()
    const plain = clickEvent({ href: '/@somechannel' })
    const cmd = clickEvent({ href: '/@somechannel', modifiers: { metaKey: true } })

    api.handleClick(plain)
    api.handleClick(cmd)

    assert.equal(plain.prevented, false)
    assert.equal(cmd.prevented, false)
    assert.equal(dispatched.length, 0)
  })

  it('leaves Shift/Alt-modified clicks alone', () => {
    const { api, dispatched } = createContext()
    const shift = clickEvent({ href: '/watch?v=x', modifiers: { shiftKey: true } })
    const alt = clickEvent({ href: '/watch?v=x', modifiers: { altKey: true } })

    api.handleClick(shift)
    api.handleClick(alt)

    assert.equal(shift.prevented, false)
    assert.equal(alt.prevented, false)
    assert.equal(dispatched.length, 0)
  })

  it('opens a middle-click on a video link in a new tab, leaves right-click alone', () => {
    const { api, dispatched } = createContext()
    const middle = clickEvent({ href: '/watch?v=x', button: 1 })
    const right = clickEvent({ href: '/watch?v=x', button: 2 })

    api.handleClick(middle)
    api.handleClick(right)

    assert.equal(middle.prevented, true)
    assert.equal(middle.stopped, true)
    assert.equal(right.prevented, false)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].detail.url, 'https://www.youtube.com/watch?v=x')
  })

  it('exposes a register function that attaches the capture-phase listeners', () => {
    const registered = []
    const context = vm.createContext({
      URL,
      CustomEvent: class {
        constructor(type, options) {
          this.type = type
          this.detail = options && options.detail
        }
      },
      dispatchEvent() {},
      location: { href: 'https://www.youtube.com/' },
      document: {
        addEventListener(type, handler, capture) {
          registered.push({ type, capture })
        },
      },
    })
    vm.runInContext(source, context)
    const { register } = context.NoirvaDesktopTabOpen

    assert.equal(typeof register, 'function')
    register(context)

    assert.deepEqual(registered, [
      { type: 'click', capture: true },
      { type: 'auxclick', capture: true },
    ])
  })

  it('ignores clicks with no anchor target', () => {
    const { api, dispatched } = createContext()
    const event = {
      button: 0,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: { tagName: 'BODY', parentNode: null },
      prevented: false,
      preventDefault() {
        this.prevented = true
      },
      stopPropagation() {},
    }

    api.handleClick(event)

    assert.equal(event.prevented, false)
    assert.equal(dispatched.length, 0)
  })
})
