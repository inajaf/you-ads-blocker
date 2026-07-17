import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

before(async () => {
  await import('../extension/desktop-guide.js')
  await import('../extension/desktop-guide-ui.js')
})

describe('desktop first-run guide model', () => {
  it('contains a short ordered walkthrough', () => {
    const guide = globalThis.TubeDesktopGuide
    assert.equal(guide.STEPS.length, 4)
    assert.deepEqual(
      guide.STEPS.map((step) => step.icon),
      ['play', 'shield', 'back', 'check'],
    )
    for (const step of guide.STEPS) {
      assert.ok(step.title.length > 0)
      assert.ok(step.description.length > 0)
      assert.equal(step.points.length, 2)
    }
  })

  it('shows again only when the stored guide version is behind', () => {
    const guide = globalThis.TubeDesktopGuide
    assert.equal(guide.isFirstRun(undefined), true)
    assert.equal(guide.isFirstRun(0), true)
    assert.equal(guide.isFirstRun(guide.VERSION), false)
    assert.equal(guide.isFirstRun(guide.VERSION + 1), false)
  })

  it('clamps navigation to the available steps', () => {
    const guide = globalThis.TubeDesktopGuide
    assert.equal(guide.clampStep(-20), 0)
    assert.equal(guide.clampStep(2.8), 2)
    assert.equal(guide.clampStep(999), guide.STEPS.length - 1)
    assert.equal(guide.hasNextStep(0), true)
    assert.equal(guide.hasNextStep(guide.STEPS.length - 1), false)
  })

  it('adapts persistent Web Storage for the Electron guide', async () => {
    const values = new Map()
    const webStorage = {
      getItem(key) {
        return values.has(key) ? values.get(key) : null
      },
      setItem(key, value) {
        values.set(key, value)
      },
    }
    const storage = globalThis.TubeDesktopGuideUI.createWebStorageAdapter(
      webStorage,
      'guide-version',
    )

    assert.equal(await storage.getCompletedVersion(), 0)
    await storage.setCompletedVersion(globalThis.TubeDesktopGuide.VERSION)
    assert.equal(await storage.getCompletedVersion(), globalThis.TubeDesktopGuide.VERSION)
  })

  it('loads the shared guide model, UI, and styles from Electron preload', () => {
    const preload = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8')
    const guideUI = fs.readFileSync(
      new URL('../extension/desktop-guide-ui.js', import.meta.url),
      'utf8',
    )
    assert.match(preload, /extension.*desktop-guide\.js/s)
    assert.match(preload, /extension.*desktop-guide-ui\.js/s)
    assert.match(preload, /extension.*content\.css/s)
    assert.match(preload, /TubeDesktopGuideUI\.install/)
    assert.match(preload, /tube\.electronDesktopGuideVersion/)
    assert.doesNotMatch(guideUI, /\.innerHTML\s*=/)
  })
})
