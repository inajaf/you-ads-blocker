import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
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
console.log('Extension copied to dist-extension/')
console.log('Load unpacked in chrome://extensions → dist-extension (or extension/)')
