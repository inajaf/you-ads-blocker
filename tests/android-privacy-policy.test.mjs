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
