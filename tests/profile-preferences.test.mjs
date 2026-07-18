import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { prepareNoirvaProfilePreferences } from '../desktop/profile-preferences.mjs'

describe('Noirva private profile preferences', () => {
  it('disables translation prompts without changing unrelated profile state', () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'noirva-profile-'))
    const defaultDir = path.join(profileDir, 'Default')
    const preferencesPath = path.join(defaultDir, 'Preferences')
    mkdirSync(defaultDir)
    writeFileSync(
      preferencesPath,
      JSON.stringify({
        profile: { name: 'Noirva' },
        translate: { blocked_languages: ['az'] },
        account_id: 'preserved',
      }),
    )

    try {
      assert.equal(prepareNoirvaProfilePreferences(profileDir).changed, true)
      const preferences = JSON.parse(readFileSync(preferencesPath, 'utf8'))
      assert.deepEqual(preferences.profile, { name: 'Noirva' })
      assert.equal(preferences.account_id, 'preserved')
      assert.deepEqual(preferences.translate, {
        blocked_languages: ['az'],
        enabled: false,
      })
      assert.equal(prepareNoirvaProfilePreferences(profileDir).changed, false)
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('does not create a profile file before Chrome creates the profile', () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'noirva-profile-'))
    try {
      assert.equal(
        prepareNoirvaProfilePreferences(profileDir).reason,
        'preferences-not-created',
      )
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})
