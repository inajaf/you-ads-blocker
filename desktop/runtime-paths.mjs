import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const runtimeBundle = process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64'
const appSupportDir = path.join(homedir(), 'Library', 'Application Support')
const legacyProfileDir = path.join(appSupportDir, 'Tube Desktop Chrome')
const legacyRuntimeDir = path.join(appSupportDir, 'Tube Desktop Runtime')
const defaultProfileDir = existsSync(legacyProfileDir)
  ? legacyProfileDir
  : path.join(appSupportDir, 'Noirva Desktop Chrome')
const defaultRuntimeDir = existsSync(legacyRuntimeDir)
  ? legacyRuntimeDir
  : path.join(appSupportDir, 'Noirva Desktop Runtime')

export const profileDir =
  process.env.NOIRVA_PROFILE_DIR ||
  process.env.TUBE_PROFILE_DIR ||
  defaultProfileDir

export const chromePath =
  process.env.NOIRVA_CHROME_PATH ||
  process.env.TUBE_CHROME_PATH ||
  path.join(
    defaultRuntimeDir,
    runtimeBundle,
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  )

export function ensureChromeRuntime() {
  if (process.platform !== 'darwin') {
    console.error('Noirva Desktop currently supports macOS only.')
    process.exit(1)
  }
  if (existsSync(chromePath)) return

  console.error('Chrome for Testing was not found.')
  console.error(`Expected: ${chromePath}`)
  console.error('Set NOIRVA_CHROME_PATH to the Chrome for Testing executable and retry.')
  process.exit(1)
}
