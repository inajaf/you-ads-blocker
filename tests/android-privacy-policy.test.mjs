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
  assert.match(policyHtml, /does not operate analytics, advertising, telemetry/)
  assert.match(policyHtml, /WebView may store cookies, site data, cache/)
  assert.match(policyHtml, /Google Privacy Policy/)
  assert.match(policyHtml, /not directed to children under 13/)
  assert.match(policyHtml, /GitHub issue tracker/)
})
