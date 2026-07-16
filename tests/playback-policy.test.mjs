import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { decidePlayback } from '../src/player/playbackPolicy.ts'

describe('decidePlayback', () => {
  it('always uses the stream player on mobile', () => {
    for (const shield of [
      { state: 'checking' },
      { state: 'active', enabled: true, version: '2.0.0' },
      { state: 'inactive', enabled: false },
    ]) {
      const decision = decidePlayback('mobile', shield)
      assert.equal(decision.mode, 'stream')
      assert.equal(decision.environment, 'mobile')
      assert.equal(decision.shield, shield)
    }
  })

  it('waits while the desktop extension status is checking', () => {
    const decision = decidePlayback('desktop', { state: 'checking' })
    assert.equal(decision.mode, 'checking')
  })

  it('uses YouTube embed on desktop only when Shield is active', () => {
    const decision = decidePlayback('desktop', {
      state: 'active',
      enabled: true,
      version: '2.0.0',
    })
    assert.equal(decision.mode, 'embed')
  })

  it('requires Shield when the desktop extension is inactive', () => {
    const decision = decidePlayback('desktop', {
      state: 'inactive',
      enabled: false,
    })
    assert.equal(decision.mode, 'shield_required')
  })
})
