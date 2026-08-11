import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveVersionedExtensionDir } = require('../desktop/extension-path.js')

describe('desktop extension version path', () => {
  it('uses a versioned runtime path so Chrome reloads extension updates', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'advoid-extension-'))
    try {
      writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.3.6' }))
      const versioned = path.join(root, 'advoid-1.3.6')
      mkdirSync(versioned)
      writeFileSync(path.join(versioned, 'manifest.json'), '{}')
      assert.equal(resolveVersionedExtensionDir(root), versioned)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the root for a development extension', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'advoid-extension-'))
    try {
      writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.3.6' }))
      assert.equal(resolveVersionedExtensionDir(root), root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
