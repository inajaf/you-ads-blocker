import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const runtimeBundle = process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64'

export const profileDir =
  process.env.TUBE_PROFILE_DIR ||
  path.join(homedir(), 'Library', 'Application Support', 'Tube Desktop Chrome')

export const chromePath =
  process.env.TUBE_CHROME_PATH ||
  path.join(
    homedir(),
    'Library',
    'Application Support',
    'Tube Desktop Runtime',
    runtimeBundle,
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  )

export function ensureChromeRuntime() {
  if (process.platform !== 'darwin') {
    console.error('Tube Desktop currently supports macOS only.')
    process.exit(1)
  }
  if (existsSync(chromePath)) return

  console.error('Chrome for Testing was not found.')
  console.error(`Expected: ${chromePath}`)
  console.error('Set TUBE_CHROME_PATH to the Chrome for Testing executable and retry.')
  process.exit(1)
}
