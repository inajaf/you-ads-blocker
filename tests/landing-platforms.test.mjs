import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectPlatform } from '../src/landing/detectPlatform.ts'
import {
  DOWNLOAD_PLATFORMS,
  PLATFORMS,
  isDownloadPlatform,
  orderByDetectedPlatform,
} from '../src/landing/platforms.ts'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const MACOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

test('detectPlatform prefers userAgentData.platform when present', () => {
  assert.equal(
    detectPlatform({ userAgentData: { platform: 'Android' }, userAgent: WINDOWS_UA }),
    'android',
  )
  assert.equal(detectPlatform({ userAgentData: { platform: 'macOS' } }), 'macos')
  assert.equal(detectPlatform({ userAgentData: { platform: 'Windows' } }), 'windows')
})

test('detectPlatform falls back to userAgent/platform strings', () => {
  assert.equal(detectPlatform({ userAgent: ANDROID_UA }), 'android')
  assert.equal(detectPlatform({ userAgent: IOS_UA }), 'ios')
  assert.equal(detectPlatform({ userAgent: MACOS_UA, platform: 'MacIntel' }), 'macos')
  assert.equal(detectPlatform({ userAgent: WINDOWS_UA }), 'windows')
})

test('detectPlatform returns unknown for inconclusive input', () => {
  assert.equal(detectPlatform({ userAgent: 'some-bot/1.0' }), 'unknown')
  assert.equal(detectPlatform({}), 'unknown')
})

test('PLATFORMS download entries use the "latest release" URL convention', () => {
  for (const platform of DOWNLOAD_PLATFORMS) {
    assert.match(
      platform.href,
      /^https:\/\/github\.com\/inajaf\/you-ads-blocker\/releases\/latest\/download\/[^/]+$/,
      `${platform.id} href should point at releases/latest/download`,
    )
  }
})

test('isDownloadPlatform separates real downloads from source-only entries', () => {
  assert.equal(PLATFORMS.every(isDownloadPlatform), true)
  assert.equal(DOWNLOAD_PLATFORMS.every(isDownloadPlatform), true)
  assert.equal(
    DOWNLOAD_PLATFORMS.every((p) => p.id !== 'ios' || p.kind === 'download'),
    true,
  )
})

test('orderByDetectedPlatform moves the matched platform to the front', () => {
  const ordered = orderByDetectedPlatform(DOWNLOAD_PLATFORMS, 'macos')
  assert.equal(ordered[0].id, 'macos')
  assert.deepEqual(
    ordered.map((p) => p.id).sort(),
    DOWNLOAD_PLATFORMS.map((p) => p.id).sort(),
  )
})

test('orderByDetectedPlatform keeps default order when detection is unknown', () => {
  for (const detected of ['unknown']) {
    const ordered = orderByDetectedPlatform(DOWNLOAD_PLATFORMS, detected)
    assert.deepEqual(
      ordered.map((p) => p.id),
      DOWNLOAD_PLATFORMS.map((p) => p.id),
    )
  }
})

test('orderByDetectedPlatform does not mutate its input', () => {
  const before = DOWNLOAD_PLATFORMS.map((p) => p.id)
  orderByDetectedPlatform(DOWNLOAD_PLATFORMS, 'macos')
  assert.deepEqual(
    DOWNLOAD_PLATFORMS.map((p) => p.id),
    before,
  )
})
