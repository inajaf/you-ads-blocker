import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const src = join(root, 'extension')
const out = join(root, 'dist-extension')

if (!existsSync(src)) {
  console.error('extension/ not found')
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(src, out, { recursive: true })
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'))
const versionedOut = join(out, `advoid-${manifest.version}`)
cpSync(src, versionedOut, { recursive: true })
console.log('Extension copied to dist-extension/')
console.log(`Runtime extension: dist-extension/advoid-${manifest.version}/`)
console.log('Manual development: load dist-extension/ or extension/ unpacked')
