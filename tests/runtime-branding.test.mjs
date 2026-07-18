import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  chromeAppPathFromExecutable,
  ensureChromeRuntimeBranding,
  isManagedChromeRuntime,
} from '../desktop/runtime-branding.mjs'

describe('private Chrome runtime branding', () => {
  const managedRoot = '/Users/example/Library/Application Support/Noirva Desktop Runtime'
  const executable = `${managedRoot}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

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
})
