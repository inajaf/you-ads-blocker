import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const desktopPackage = JSON.parse(
  fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'),
)
const workflow = fs.readFileSync(
  new URL('../.github/workflows/desktop-build.yml', import.meta.url),
  'utf8',
)

describe('AdVoid desktop cross-platform packaging', () => {
  it('rebuilds the shared extension before both macOS and Windows packages', () => {
    assert.match(desktopPackage.scripts['dist:mac'], /cd \.\. && npm run build:extension/)
    assert.match(desktopPackage.scripts['dist:win'], /cd \.\. && npm run build:extension/)
  })

  it('builds Intel and Apple Silicon DMGs with the shared Electron app', () => {
    const macTarget = desktopPackage.build.mac.target[0]
    assert.equal(macTarget.target, 'dmg')
    assert.deepEqual(macTarget.arch, ['x64', 'arm64'])
  })

  it('keeps the stable Windows download filename used by the landing page', () => {
    assert.equal(
      desktopPackage.build.win.artifactName,
      'AdVoid-Setup-1.0.0.${ext}',
    )
  })

  it('builds both desktop platforms without reacting to unrelated release tags', () => {
    assert.match(workflow, /macos-14/)
    assert.match(workflow, /windows-latest/)
    assert.match(workflow, /workflow_dispatch/)
    assert.doesNotMatch(workflow, /tags:/)
    assert.doesNotMatch(workflow, /gh release upload/)
  })
})
