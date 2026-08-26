import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectPlatform } from '../src/landing/detectPlatform.ts'
import {
  DOWNLOAD_PLATFORMS,
  PLATFORMS,
  isDownloadPlatform,
  orderByDetectedPlatform,
} from '../src/landing/platforms.ts'
import { FAQS } from '../src/landing/faq.ts'

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
    for (const download of platform.additionalDownloads ?? []) {
      assert.match(
        download.href,
        /^https:\/\/github\.com\/inajaf\/you-ads-blocker\/releases\/latest\/download\/[^/]+$/,
        `${platform.id} additional download should point at releases/latest/download`,
      )
    }
  }
})

test('Android landing card exposes both signed release files', () => {
  const android = DOWNLOAD_PLATFORMS.find((platform) => platform.id === 'android')
  assert.ok(android)
  assert.equal(android.href.endsWith('/app-release.apk'), true)
  assert.deepEqual(
    android.additionalDownloads?.map((download) => download.href.split('/').at(-1)),
    ['app-release.aab'],
  )
})

test('macOS landing card defaults to Apple Silicon and links Intel as secondary', () => {
  const macos = DOWNLOAD_PLATFORMS.find((platform) => platform.id === 'macos')
  assert.ok(macos)
  assert.equal(macos.href.endsWith('/AdVoid-1.0.0-arm64.dmg'), true)
  assert.deepEqual(
    macos.additionalDownloads?.map((download) => download.href.split('/').at(-1)),
    ['AdVoid-1.0.0-x64.dmg'],
  )
})

test('macOS install guidance no longer recommends the right-click bypass', () => {
  // The old FAQ claimed "The app is signed and safe" + right-click → Open. On
  // Apple Silicon quarantined ad-hoc builds die as "damaged" and right-click
  // does nothing; the reliable workaround is removing the quarantine attribute.
  const macos = DOWNLOAD_PLATFORMS.find((platform) => platform.id === 'macos')
  const damagedFaq = FAQS.find((item) => item.q.startsWith('macOS says'))
  assert.ok(macos, 'macOS download card must exist')
  assert.ok(damagedFaq, 'macOS damaged-app FAQ must exist')
  for (const text of [macos.note, ...macos.additionalDownloads.map((d) => d.note), damagedFaq.a]) {
    assert.doesNotMatch(text, /app is signed/i, 'must not claim the app is signed for distribution')
  }
  for (const text of [macos.note, damagedFaq.a]) {
    assert.match(text, /(quarantine|xattr)/i, 'unsigned-mac install guidance must point at the real workaround')
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
