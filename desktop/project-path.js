'use strict'
const path = require('path')

const isPacked = typeof __filename === 'string' && __filename.includes('.asar')

function resolveProjectPath(...segments) {
  const base = isPacked ? process.resourcesPath : path.resolve(__dirname, '..')
  return path.join(base, ...segments)
}

module.exports = { resolveProjectPath }
