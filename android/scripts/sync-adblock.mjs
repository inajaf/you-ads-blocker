#!/usr/bin/env node
/**
 * Copy the shared ad-block core into the Android app's assets so the wrapper
 * ships the exact same blocklist + json-prune script as the extension/desktop.
 *
 * Single source of truth lives in /adblock. The copies under
 * app/src/main/assets/ are GENERATED — do not edit them by hand.
 *
 * Usage (from the android/ directory, or anywhere):
 *   node scripts/sync-adblock.mjs
 *
 * NOTE: The repo also documents a canonical top-level `scripts/sync-adblock.mjs`.
 * This copy is bundled inside android/ so the Android project is self-contained
 * and can refresh its assets without depending on files outside android/.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// android/scripts -> repo root
const repoRoot = resolve(here, '..', '..')
const srcDir = resolve(repoRoot, 'adblock')
const destDir = resolve(here, '..', 'app', 'src', 'main', 'assets')

const files = ['hosts.json', 'inject.js']

await mkdir(destDir, { recursive: true })
for (const f of files) {
  const src = resolve(srcDir, f)
  const dest = resolve(destDir, f)
  await copyFile(src, dest)
  console.log(`synced ${f} -> ${dest}`)
}
console.log('adblock assets in sync.')
