import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  MACOS_TRAFFIC_LIGHT_POSITION,
  createDesktopWindowOptions,
  createTabStripLoadOptions,
} = require('../desktop/window-options.js')

describe('AdVoid desktop platform window options', () => {
  it('integrates the tab strip with the macOS title bar without covering traffic lights', () => {
    const options = createDesktopWindowOptions({
      platform: 'darwin',
      icon: '/tmp/advoid.png',
    })

    assert.equal(options.title, 'AdVoid')
    assert.equal(options.titleBarStyle, 'hiddenInset')
    assert.deepEqual(options.trafficLightPosition, MACOS_TRAFFIC_LIGHT_POSITION)
    assert.equal(options.webPreferences.contextIsolation, true)
  })

  it('keeps native Windows window chrome unchanged', () => {
    const options = createDesktopWindowOptions({
      platform: 'win32',
      icon: 'C:\\AdVoid\\icon.ico',
    })

    assert.equal(options.title, 'AdVoid')
    assert.equal(options.titleBarStyle, undefined)
    assert.equal(options.trafficLightPosition, undefined)
  })

  it('passes the runtime platform to the isolated tab strip document', () => {
    assert.deepEqual(createTabStripLoadOptions('darwin'), {
      query: { platform: 'darwin' },
    })
  })
})
