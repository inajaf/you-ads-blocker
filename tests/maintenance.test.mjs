import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

before(async () => {
  await import('../extension/maintenance.js')
})

describe('Noirva profile maintenance', () => {
  it('clears history and cache without touching sign-in data', async () => {
    const calls = []
    const maintenance = globalThis.NoirvaMaintenance.createMaintenanceService({
      browsingData: {
        async remove(options, dataTypes) {
          calls.push({ options, dataTypes })
        },
      },
    })

    assert.deepEqual(await maintenance.clear('history'), {
      ok: true,
      action: 'history',
    })
    assert.deepEqual(await maintenance.clear('cache'), {
      ok: true,
      action: 'cache',
    })
    assert.deepEqual(calls, [
      { options: { since: 0 }, dataTypes: { history: true } },
      { options: { since: 0 }, dataTypes: { cache: true } },
    ])
    for (const { dataTypes } of calls) {
      assert.equal(dataTypes.cookies, undefined)
      assert.equal(dataTypes.passwords, undefined)
      assert.equal(dataTypes.localStorage, undefined)
    }
  })

  it('rejects unsupported cleanup actions before calling Chrome', async () => {
    let callCount = 0
    const maintenance = globalThis.NoirvaMaintenance.createMaintenanceService({
      browsingData: {
        async remove() {
          callCount += 1
        },
      },
    })

    assert.deepEqual(await maintenance.clear('cookies'), {
      ok: false,
      error: 'Unsupported maintenance action.',
    })
    assert.equal(callCount, 0)
  })

  it('wires the permission, worker command and app toolbar UI together', () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
    )
    const background = fs.readFileSync(
      new URL('../extension/background.js', import.meta.url),
      'utf8',
    )
    const content = fs.readFileSync(
      new URL('../extension/content.js', import.meta.url),
      'utf8',
    )
    const guideUI = fs.readFileSync(
      new URL('../extension/desktop-guide-ui.js', import.meta.url),
      'utf8',
    )
    const popup = fs.readFileSync(
      new URL('../extension/popup.html', import.meta.url),
      'utf8',
    )

    assert.ok(manifest.permissions.includes('browsingData'))
    assert.ok(manifest.content_scripts[0].js.includes('maintenance.js'))
    assert.match(background, /createMaintenanceService/)
    assert.match(background, /MAINTENANCE_MESSAGE/)
    assert.match(content, /maintenanceModel\.MAINTENANCE_MESSAGE/)
    assert.match(guideUI, /tube-desktop-maintenance/)
    assert.match(guideUI, /Clear history/)
    assert.match(guideUI, /Clear cache/)
    assert.doesNotMatch(guideUI, /[А-Яа-яЁё]/)
    assert.match(popup, /Block ads/)
    assert.doesNotMatch(popup, /[А-Яа-яЁё]/)
    assert.doesNotMatch(guideUI, /\.innerHTML\s*=/)
  })

  it('collapses ad-owned rich-grid cells and hides the YouTube menu only in app mode', () => {
    const css = fs.readFileSync(new URL('../extension/content.css', import.meta.url), 'utf8')
    const content = fs.readFileSync(
      new URL('../extension/content.js', import.meta.url),
      'utf8',
    )

    assert.match(css, /ytd-rich-item-renderer:has\(ytd-ad-slot-renderer\)/)
    assert.match(css, /\.tube-hidden-ad-container/)
    assert.match(css, /\.tube-desktop-app ytd-masthead #guide-button/)
    assert.match(content, /collapseFeedAdContainers/)
    assert.match(content, /content\.childElementCount === 0/)
    assert.match(content, /classList\.toggle\('tube-desktop-app'/)
  })
})
