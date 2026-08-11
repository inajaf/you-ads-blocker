'use strict'

const fs = require('node:fs')
const path = require('node:path')

function resolveVersionedExtensionDir(rootDir) {
  const manifestPath = path.join(rootDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const versionedDir = path.join(rootDir, `advoid-${manifest.version}`)
    if (fs.existsSync(path.join(versionedDir, 'manifest.json'))) return versionedDir
  } catch (error) {
    console.warn(`[AdVoid] could not read extension version: ${error.message}`)
  }

  return rootDir
}

module.exports = { resolveVersionedExtensionDir }
