import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isChromeProfileRunning, waitForChromeStartup } from './chrome-launch.mjs'
import { chromePath, ensureChromeRuntime, profileDir } from './runtime-paths.mjs'

const desktopDir = path.dirname(fileURLToPath(import.meta.url))
const extensionDir = path.resolve(desktopDir, '..', 'dist-extension')

ensureChromeRuntime()

if (!existsSync(path.join(extensionDir, 'manifest.json'))) {
  console.error('The Tube extension is not built. Run npm run build:extension first.')
  process.exit(1)
}

const chrome = spawn(
  chromePath,
  [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    '--disable-infobars',
    '--app=https://www.youtube.com/?tube_app=1',
  ],
  {
    detached: true,
    stdio: 'ignore',
  },
)

try {
  const result = await waitForChromeStartup(chrome, {
    isProfileRunning: () => isChromeProfileRunning({ chromePath, profileDir }),
  })
  if (chrome.exitCode === null) chrome.unref()
  if (result.forwarded) {
    console.log('Tube request was forwarded to the existing Chrome profile.')
  }
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

console.log('Tube opened in a dedicated Google Chrome app window.')
console.log(`Persistent profile: ${profileDir}`)
console.log(`Ad blocker: ${extensionDir}`)
