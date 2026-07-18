import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  chmodSync,
} from 'node:fs'
import path from 'node:path'

/**
 * Keep Chrome-only prompts out of Noirva's dedicated private profile.
 * This never touches the user's normal Chrome profile or authentication data.
 */
export function prepareNoirvaProfilePreferences(profileDir) {
  if (!profileDir) throw new TypeError('A Noirva profile directory is required')

  const preferencesPath = path.join(profileDir, 'Default', 'Preferences')
  if (!existsSync(preferencesPath)) {
    return { changed: false, reason: 'preferences-not-created', preferencesPath }
  }

  let preferences
  try {
    preferences = JSON.parse(readFileSync(preferencesPath, 'utf8'))
  } catch (error) {
    return { changed: false, reason: 'invalid-preferences', preferencesPath, error }
  }

  const translate =
    preferences.translate && typeof preferences.translate === 'object'
      ? preferences.translate
      : {}
  if (translate.enabled === false) {
    return { changed: false, reason: 'already-prepared', preferencesPath }
  }

  preferences.translate = { ...translate, enabled: false }
  const temporaryPath = `${preferencesPath}.noirva-tmp`
  const mode = statSync(preferencesPath).mode
  writeFileSync(temporaryPath, JSON.stringify(preferences), 'utf8')
  chmodSync(temporaryPath, mode & 0o777)
  renameSync(temporaryPath, preferencesPath)

  return { changed: true, preferencesPath }
}
