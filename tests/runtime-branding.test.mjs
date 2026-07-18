import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  chromeAppPathFromExecutable,
  ensureChromeRuntimeBranding,
  isManagedChromeRuntime,
} from '../desktop/runtime-branding.mjs'
import { runtimeLayout } from '../desktop/runtime-paths.mjs'

describe('private Chrome runtime branding', () => {
  const managedRoot = '/Users/example/Library/Application Support/Noirva Desktop Runtime'
  const executable = `${managedRoot}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

  it('selects the Chrome for Testing bundle for Windows architectures', () => {
    assert.equal(runtimeLayout('win32', 'x64').bundleDir, 'chrome-win64')
    assert.equal(runtimeLayout('win32', 'ia32').bundleDir, 'chrome-win32')
    assert.deepEqual(runtimeLayout('win32', 'x64').executableParts, ['chrome.exe'])
    assert.equal(runtimeLayout('linux', 'x64'), null)
  })

  it('derives the owning macOS app bundle from the Chrome executable', () => {
    assert.equal(
      chromeAppPathFromExecutable(executable),
      `${managedRoot}/chrome-mac-arm64/Google Chrome for Testing.app`,
    )
    assert.throws(
      () => chromeAppPathFromExecutable('/Applications/Google Chrome'),
      /not inside a macOS app bundle/,
    )
  })

  it('accepts only paths contained by a Noirva-managed runtime root', () => {
    assert.equal(isManagedChromeRuntime(executable, [managedRoot]), true)
    assert.equal(
      isManagedChromeRuntime(
        '/Users/example/Library/Application Support/Noirva Desktop Runtime Backup/chrome.app',
        [managedRoot],
      ),
      false,
    )
    assert.equal(
      isManagedChromeRuntime(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        [managedRoot],
      ),
      false,
    )
  })

  it('leaves external browser bundles and non-macOS platforms unchanged', () => {
    assert.deepEqual(
      ensureChromeRuntimeBranding({
        chromeExecutablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        platform: 'darwin',
        managedRuntimeRoots: [managedRoot],
      }),
      {
        branded: false,
        changed: false,
        reason: 'external-runtime',
        appPath: '/Applications/Google Chrome.app',
      },
    )
    assert.deepEqual(
      ensureChromeRuntimeBranding({
        chromeExecutablePath: executable,
        platform: 'linux',
        managedRuntimeRoots: [managedRoot],
      }),
      { branded: false, changed: false, reason: 'unsupported-platform' },
    )
  })

  it('brands only a managed Windows runtime and keeps a recoverable backup', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'noirva-windows-branding-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const windowsExecutable = path.join(root, 'chrome-win64', 'chrome.exe')
    const windowsIcon = path.join(root, 'noirva.ico')
    const rceditPath = path.join(root, 'rcedit-x64.exe')
    mkdirSync(path.dirname(windowsExecutable), { recursive: true })
    writeFileSync(windowsExecutable, 'original chrome')
    writeFileSync(windowsIcon, 'icon')
    writeFileSync(rceditPath, 'rcedit')

    let brandingCalls = 0
    const execFileSyncImpl = (executablePath, args) => {
      brandingCalls += 1
      assert.equal(executablePath, rceditPath)
      assert.ok(args.includes('--set-icon'))
      writeFileSync(windowsExecutable, 'branded chrome')
    }
    const options = {
      chromeExecutablePath: windowsExecutable,
      platform: 'win32',
      iconPath: windowsIcon,
      managedRuntimeRoots: [root],
      rceditPath,
      execFileSyncImpl,
    }

    assert.equal(ensureChromeRuntimeBranding(options).changed, true)
    assert.equal(ensureChromeRuntimeBranding(options).changed, false)
    assert.equal(brandingCalls, 1)
    assert.equal(
      readFileSync(`${windowsExecutable}.noirva-original.exe`, 'utf8'),
      'original chrome',
    )
    assert.equal(existsSync(`${windowsExecutable}.noirva-branding.json`), true)
  })
})
