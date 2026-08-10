import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const KT_PATH = fileURLToPath(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url),
)

function extractScript() {
  const source = readFileSync(KT_PATH, 'utf8')
  const match = source.match(
    /internal const val FULLSCREEN_SETTINGS_SCRIPT = """([\s\S]*?)"""/,
  )
  assert.ok(match, 'FULLSCREEN_SETTINGS_SCRIPT not found in MainActivity.kt')
  return match[1].replace(/\r\n/g, '\n')
}

const SCRIPT = extractScript()

class Node {
  constructor(tagName = '') {
    this.tagName = tagName.toUpperCase()
    this.parentNode = null
    this.children = []
    this.className = ''
  }

  get nextSibling() {
    if (!this.parentNode) return null
    const index = this.parentNode.children.indexOf(this)
    return this.parentNode.children[index + 1] ?? null
  }

  get childElementCount() {
    return this.children.length
  }

  appendChild(child) {
    child.remove()
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, before) {
    child.remove()
    const index = before ? this.children.indexOf(before) : -1
    child.parentNode = this
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }

  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter((node) => node !== this)
    this.parentNode = null
  }

  contains(other) {
    if (other === this) return true
    return this.children.some((child) => child.contains(other))
  }

  closest(selector) {
    if (
      selector === 'button.player-settings-icon' &&
      this.tagName === 'BUTTON' &&
      this.className.split(/\s+/).includes('player-settings-icon')
    ) return this
    return this.parentNode?.closest(selector) ?? null
  }
}

function makeEnv() {
  const root = new Node('html')
  const app = new Node('ytm-app')
  const sheet = new Node('bottom-sheet-container')
  const after = new Node('div')
  const player = new Node('div')
  const settings = new Node('button')
  settings.className = 'icon-button player-settings-icon'
  settings.clickCount = 0
  settings.click = () => {
    settings.clickCount += 1
    if (sheet.children.length === 0) sheet.appendChild(new Node('bottom-sheet-layout'))
  }
  const menuItem = new Node('span')
  menuItem.clickCount = 0
  menuItem.click = () => { menuItem.clickCount += 1 }
  root.appendChild(app)
  app.appendChild(sheet)
  app.appendChild(after)
  app.appendChild(player)
  player.appendChild(settings)

  const listeners = new Map()
  let activeGear = settings
  let replacementGearOnExit = null
  const document = {
    documentElement: root,
    fullscreenElement: null,
    querySelector(selector) {
      if (selector === 'bottom-sheet-container') return sheet
      if (selector === 'button.player-settings-icon') return activeGear
      return null
    },
    createComment() {
      return new Node('#comment')
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
  }
  const fire = (type, event = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  document.exitFullscreen = async () => {
    document.fullscreenElement = null
    if (replacementGearOnExit) activeGear = replacementGearOnExit
    fire('fullscreenchange')
  }
  player.requestFullscreen = async () => {
    document.fullscreenElement = player
    fire('fullscreenchange')
  }
  const timers = []
  const setTimeout = (callback) => timers.push(callback)
  const flushTimers = () => timers.splice(0).forEach((callback) => callback())
  const window = {}
  vm.runInNewContext(SCRIPT, { document, window, setTimeout })
  return {
    app, sheet, after, player, settings, menuItem, document, window, fire, flushTimers,
    replaceGearOnExit(gear) { replacementGearOnExit = gear },
  }
}

function clickEvent(target) {
  return {
    target,
    preventDefault() {},
    stopImmediatePropagation() {},
  }
}

async function settle(env) {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  env.flushTimers()
}

describe('Android fullscreen playback settings bridge', () => {
  it('restores the moved sheet to its exact DOM position after fullscreen', async () => {
    const env = makeEnv()
    assert.deepEqual(env.app.children, [env.sheet, env.after, env.player])

    env.document.fullscreenElement = env.player
    env.fire('click', clickEvent(env.settings))
    await settle(env)
    assert.equal(env.player.contains(env.sheet), true)

    env.document.fullscreenElement = null
    env.fire('fullscreenchange')
    assert.deepEqual(env.app.children, [env.sheet, env.after, env.player])
    assert.equal(env.window._advoidFullscreenSettingsMarker, null)
  })

  it('replays the gear tap through YouTube and returns its sheet to fullscreen', async () => {
    const env = makeEnv()
    env.document.fullscreenElement = env.player
    env.fire('click', clickEvent(env.settings))
    assert.equal(env.sheet.parentNode, env.app)
    await settle(env)
    assert.equal(env.settings.clickCount, 1)
    assert.equal(env.document.fullscreenElement, env.player)
    assert.equal(env.player.contains(env.sheet), true)
  })

  it('does not move the sheet for a normal in-page gear tap', () => {
    const env = makeEnv()
    env.fire('click', clickEvent(env.settings))
    assert.equal(env.sheet.parentNode, env.app)
  })

  it('reacquires a gear replaced during fullscreen teardown', async () => {
    const env = makeEnv()
    const replacement = new Node('button')
    replacement.className = 'player-settings-icon'
    replacement.clickCount = 0
    replacement.click = () => {
      replacement.clickCount += 1
      env.sheet.appendChild(new Node('bottom-sheet-layout'))
    }
    env.replaceGearOnExit(replacement)
    env.document.fullscreenElement = env.player

    env.fire('click', clickEvent(env.settings))
    await settle(env)

    assert.equal(env.settings.clickCount, 0)
    assert.equal(replacement.clickCount, 1)
    assert.equal(env.player.contains(env.sheet), true)
  })

  it('replays clicks inside the moved settings sheet so submenus keep working', async () => {
    const env = makeEnv()
    env.document.fullscreenElement = env.player
    env.fire('click', clickEvent(env.settings))
    await settle(env)
    env.sheet.appendChild(env.menuItem)

    env.fire('click', clickEvent(env.menuItem))
    await settle(env)

    assert.equal(env.menuItem.clickCount, 1)
    assert.equal(env.document.fullscreenElement, env.player)
    assert.equal(env.player.contains(env.sheet), true)
  })
})
