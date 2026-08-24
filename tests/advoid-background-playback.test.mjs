import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const mainActivity = readFileSync(
  new URL('../android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt', import.meta.url),
  'utf8',
)
const manifest = readFileSync(
  new URL('../android/AdVoid/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)

describe('Android background playback removal', () => {
  it('does not ship the foreground playback service or its permissions', () => {
    assert.equal(
      existsSync(`${ROOT}/android/AdVoid/app/src/main/java/com/advoid/app/PlaybackService.kt`),
      false,
    )
    assert.doesNotMatch(manifest, /PlaybackService|FOREGROUND_SERVICE|POST_NOTIFICATIONS|WAKE_LOCK/)
  })

  it('does not override page visibility or auto-recover background playback', () => {
    assert.doesNotMatch(
      mainActivity,
      /BACKGROUND_PLAYBACK_SCRIPT|RECOVER_STUCK_SCRIPT|_advoidBgPlayback|playingAtBackground/,
    )
  })
})
