import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export function runtimeLayout(platform, arch) {
  if (platform === 'darwin') {
    return {
      dataRoot: path.join(homedir(), 'Library', 'Application Support'),
      bundleDir: arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64',
      executableParts: [
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      ],
    }
  }
  if (platform === 'win32') {
    return {
      dataRoot: process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
      bundleDir: arch === 'ia32' ? 'chrome-win32' : 'chrome-win64',
      executableParts: ['chrome.exe'],
    }
  }
  return null
}

const layout = runtimeLayout(process.platform, process.arch)

function defaultDataDir(legacyName, currentName) {
  if (!layout) return null
  const legacyDir = path.join(layout.dataRoot, legacyName)
  return existsSync(legacyDir) ? legacyDir : path.join(layout.dataRoot, currentName)
}

const defaultProfileDir = defaultDataDir('Tube Desktop Chrome', 'Noirva Desktop Chrome')
const defaultRuntimeDir = defaultDataDir('Tube Desktop Runtime', 'Noirva Desktop Runtime')

export const profileDir =
  process.env.NOIRVA_PROFILE_DIR ||
  process.env.TUBE_PROFILE_DIR ||
  defaultProfileDir

export const chromePath =
  process.env.NOIRVA_CHROME_PATH ||
  process.env.TUBE_CHROME_PATH ||
  (layout ? path.join(defaultRuntimeDir, layout.bundleDir, ...layout.executableParts) : '')

export function ensureChromeRuntime() {
  if (!layout) {
    console.error('Noirva Desktop currently supports macOS and Windows only.')
    process.exit(1)
  }
  if (existsSync(chromePath)) return

  console.error('Chrome for Testing was not found.')
  console.error(`Expected: ${chromePath}`)
  console.error('Download: https://googlechromelabs.github.io/chrome-for-testing/')
  console.error('Set NOIRVA_CHROME_PATH to the Chrome for Testing executable and retry.')
  process.exit(1)
}
