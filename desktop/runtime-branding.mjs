import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUTIL_PATH = '/usr/bin/plutil'
const LSREGISTER_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

const desktopDir = path.dirname(fileURLToPath(import.meta.url))
export const defaultNoirvaIconPath = path.resolve(
  desktopDir,
  '..',
  'assets',
  'brand',
  'noirva-logo-v2.icns',
)
export const defaultNoirvaWindowsIconPath = path.resolve(
  desktopDir,
  '..',
  'assets',
  'brand',
  'noirva-logo-v2.ico',
)
const defaultRceditPath = path.resolve(
  desktopDir,
  'node_modules',
  'rcedit',
  'bin',
  process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit-x64.exe',
)

const appSupportDir =
  process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local')
    : path.join(homedir(), 'Library', 'Application Support')
export const defaultManagedRuntimeRoots = [
  path.join(appSupportDir, 'Noirva Desktop Runtime'),
  path.join(appSupportDir, 'Tube Desktop Runtime'),
]

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..')
}

export function isManagedChromeRuntime(
  chromeExecutablePath,
  managedRuntimeRoots = defaultManagedRuntimeRoots,
) {
  return managedRuntimeRoots.some((root) => isPathInside(root, chromeExecutablePath))
}

export function chromeAppPathFromExecutable(chromeExecutablePath) {
  const macOSDir = path.dirname(chromeExecutablePath)
  const contentsDir = path.dirname(macOSDir)
  const appPath = path.dirname(contentsDir)

  if (
    path.basename(macOSDir) !== 'MacOS' ||
    path.basename(contentsDir) !== 'Contents' ||
    !appPath.endsWith('.app')
  ) {
    throw new Error(`Chrome executable is not inside a macOS app bundle: ${chromeExecutablePath}`)
  }

  return appPath
}

function fileDigest(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function ensureWindowsChromeRuntimeBranding({
  chromeExecutablePath,
  iconPath,
  managedRuntimeRoots,
  rceditPath,
  execFileSyncImpl,
}) {
  if (!isManagedChromeRuntime(chromeExecutablePath, managedRuntimeRoots)) {
    return {
      branded: false,
      changed: false,
      reason: 'external-runtime',
      executablePath: chromeExecutablePath,
    }
  }

  for (const requiredPath of [chromeExecutablePath, iconPath, rceditPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Noirva runtime branding file was not found: ${requiredPath}`)
    }
  }

  const markerPath = `${chromeExecutablePath}.noirva-branding.json`
  const backupPath = `${chromeExecutablePath}.noirva-original.exe`
  const iconDigest = fileDigest(iconPath)
  const executableDigest = fileDigest(chromeExecutablePath)
  const marker = readJsonFile(markerPath)
  if (
    marker?.version === 1 &&
    marker.iconDigest === iconDigest &&
    marker.executableDigest === executableDigest
  ) {
    return {
      branded: true,
      changed: false,
      executablePath: chromeExecutablePath,
      backupPath,
    }
  }

  if (!existsSync(backupPath)) copyFileSync(chromeExecutablePath, backupPath)
  execFileSyncImpl(
    rceditPath,
    [
      chromeExecutablePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'ProductName',
      'Noirva',
      '--set-version-string',
      'FileDescription',
      'Noirva',
      '--set-version-string',
      'InternalName',
      'Noirva',
    ],
    { stdio: 'ignore' },
  )

  writeFileSync(
    markerPath,
    `${JSON.stringify({
      version: 1,
      iconDigest,
      executableDigest: fileDigest(chromeExecutablePath),
    }, null, 2)}\n`,
    'utf8',
  )
  return {
    branded: true,
    changed: true,
    executablePath: chromeExecutablePath,
    backupPath,
  }
}

function readPlistValue(infoPlistPath, key) {
  try {
    return execFileSync(
      PLUTIL_PATH,
      ['-extract', key, 'raw', '-o', '-', infoPlistPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
}

function setPlistString(infoPlistPath, key, value) {
  execFileSync(
    PLUTIL_PATH,
    ['-replace', key, '-string', value, infoPlistPath],
    { stdio: 'ignore' },
  )
}

function removePlistKey(infoPlistPath, key) {
  execFileSync(PLUTIL_PATH, ['-remove', key, infoPlistPath], { stdio: 'ignore' })
}

/**
 * Brands Noirva's private Chrome for Testing bundle without touching a user's
 * installed browser. On Windows the original executable is backed up before
 * its private resources are branded. Chrome for Testing on macOS ships both
 * CFBundleIconName and CFBundleIconFile; macOS prefers the Assets.car icon
 * named by the first key, so it must be removed before the Noirva .icns file
 * can be displayed.
 */
export function ensureChromeRuntimeBranding({
  chromeExecutablePath,
  platform = process.platform,
  iconPath =
    platform === 'win32' ? defaultNoirvaWindowsIconPath : defaultNoirvaIconPath,
  managedRuntimeRoots = defaultManagedRuntimeRoots,
  rceditPath = defaultRceditPath,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (platform !== 'darwin' && platform !== 'win32') {
    return { branded: false, changed: false, reason: 'unsupported-platform' }
  }
  if (!chromeExecutablePath) {
    throw new Error('Chrome executable path is required for Noirva branding.')
  }

  if (platform === 'win32') {
    return ensureWindowsChromeRuntimeBranding({
      chromeExecutablePath,
      iconPath,
      managedRuntimeRoots,
      rceditPath,
      execFileSyncImpl,
    })
  }

  const appPath = chromeAppPathFromExecutable(chromeExecutablePath)
  if (!isManagedChromeRuntime(chromeExecutablePath, managedRuntimeRoots)) {
    return { branded: false, changed: false, reason: 'external-runtime', appPath }
  }

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist')
  const appIconPath = path.join(appPath, 'Contents', 'Resources', 'app.icns')
  for (const requiredPath of [chromeExecutablePath, infoPlistPath, iconPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Noirva runtime branding file was not found: ${requiredPath}`)
    }
  }

  let changed = false
  if (!existsSync(appIconPath) || fileDigest(appIconPath) !== fileDigest(iconPath)) {
    copyFileSync(iconPath, appIconPath)
    changed = true
  }

  if (readPlistValue(infoPlistPath, 'CFBundleDisplayName') !== 'Noirva') {
    setPlistString(infoPlistPath, 'CFBundleDisplayName', 'Noirva')
    changed = true
  }
  // macOS uses CFBundleName for the first application-menu item. Keeping it
  // branded prevents the private runtime from surfacing "Chrome for Testing"
  // inside the otherwise standalone Noirva app experience.
  if (readPlistValue(infoPlistPath, 'CFBundleName') !== 'Noirva') {
    setPlistString(infoPlistPath, 'CFBundleName', 'Noirva')
    changed = true
  }
  if (readPlistValue(infoPlistPath, 'CFBundleIconFile') !== 'app.icns') {
    setPlistString(infoPlistPath, 'CFBundleIconFile', 'app.icns')
    changed = true
  }
  if (readPlistValue(infoPlistPath, 'CFBundleIconName') !== null) {
    removePlistKey(infoPlistPath, 'CFBundleIconName')
    changed = true
  }

  if (changed) {
    const now = new Date()
    utimesSync(appPath, now, now)
    execFileSync(LSREGISTER_PATH, ['-f', appPath], { stdio: 'ignore' })
  }

  return { branded: true, changed, appPath }
}

export function prepareChromeRuntimeBranding(chromeExecutablePath) {
  try {
    const result = ensureChromeRuntimeBranding({ chromeExecutablePath })
    if (result.changed) {
      console.log('Noirva name and app icon were applied to the private Chrome runtime.')
    }
    if (result.reason === 'external-runtime') {
      console.warn('Custom Chrome path detected; Noirva left that external browser bundle unchanged.')
    }
    return result
  } catch (error) {
    console.warn(`Noirva could not brand the private Chrome runtime: ${error.message}`)
    return { branded: false, changed: false, reason: 'branding-error', error }
  }
}
