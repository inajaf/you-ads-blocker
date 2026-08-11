import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createApplicationMenuTemplate } = require('../desktop/application-menu.js')

describe('AdVoid desktop application menu', () => {
  it('uses native macOS accelerators for tab commands', () => {
    let newTabs = 0
    let closedTabs = 0
    const template = createApplicationMenuTemplate({
      platform: 'darwin',
      appName: 'AdVoid',
      onNewTab: () => newTabs++,
      onCloseTab: () => closedTabs++,
    })

    const fileMenu = template.find((item) => item.label === 'File').submenu
    const newTab = fileMenu.find((item) => item.label === 'New Tab')
    const closeTab = fileMenu.find((item) => item.label === 'Close Tab')
    assert.equal(newTab.accelerator, 'CommandOrControl+T')
    assert.equal(closeTab.accelerator, 'CommandOrControl+W')

    newTab.click()
    closeTab.click()
    assert.equal(newTabs, 1)
    assert.equal(closedTabs, 1)
  })

  it('keeps the native menu disabled on Windows and Linux', () => {
    const options = {
      appName: 'AdVoid',
      onNewTab() {},
      onCloseTab() {},
    }
    assert.equal(createApplicationMenuTemplate({ ...options, platform: 'win32' }), null)
    assert.equal(createApplicationMenuTemplate({ ...options, platform: 'linux' }), null)
  })
})
