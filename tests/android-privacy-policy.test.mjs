import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const policyHtml = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8')
const androidPolicy = await readFile(
  new URL(
    '../android/AdVoid/app/src/main/java/com/advoid/app/PrivacyPolicy.kt',
    import.meta.url,
  ),
  'utf8',
)

test('Android links to the standalone GitHub Pages privacy policy', () => {
  assert.match(
    androidPolicy,
    /https:\/\/inajaf\.github\.io\/you-ads-blocker\/privacy\.html/,
  )
  assert.match(policyHtml, /<title>AdVoid Privacy Policy<\/title>/)
})

test('privacy policy describes current WebView data handling', () => {
  assert.match(
    policyHtml,
    /no developer-operated backend, account database, analytics, telemetry, or advertising SDK/,
  )
  assert.match(
    policyHtml,
    /developer does not collect, receive, retain, sell, or share user data through AdVoid/,
  )
  assert.match(policyHtml, /AdVoid app preferences stay on your device/)
  assert.match(policyHtml, /WebView may also store cookies, site data, cache/)
  assert.match(policyHtml, /clearing AdVoid's storage or uninstalling the app/)
  assert.match(policyHtml, /connects directly to YouTube and Google/)
  assert.match(policyHtml, /Google Privacy Policy/)
  assert.match(policyHtml, /not directed to children under 13/)
  assert.match(policyHtml, /GitHub issue tracker/)
  assert.doesNotMatch(policyHtml, /email will be listed here/)
})

test('privacy policy discloses the background-audio foreground service', () => {
  // The app added FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PLAYBACK and
  // POST_NOTIFICATIONS for background audio, so the policy must not still claim
  // internet access is the only permission.
  assert.doesNotMatch(policyHtml, /requests only Android internet access/)
  assert.match(policyHtml, /media-playback foreground service and notification permission/)
  assert.match(policyHtml, /only notification AdVoid shows/)
})

test('every declared Android permission is disclosed in the policy', async () => {
  const manifest = await readFile(
    new URL('../android/AdVoid/app/src/main/AndroidManifest.xml', import.meta.url),
    'utf8',
  )
  const declared = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)]
    .map((match) => match[1])
    .sort()
  // An allowlist, so a future permission cannot be added silently.
  assert.deepEqual(declared, [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
  ])
  const disclosure = {
    'android.permission.INTERNET': /internet access/i,
    'android.permission.FOREGROUND_SERVICE': /media-playback foreground service/i,
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK': /media-playback foreground service/i,
    'android.permission.POST_NOTIFICATIONS': /notification permission/i,
  }
  for (const permission of declared) {
    assert.match(policyHtml, disclosure[permission], `${permission} must be disclosed`)
  }
})
