import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedMediaUrl } from '../server/media-proxy.mjs'
import { handleProxy, isAllowedApiBase } from '../server/proxy-core.mjs'

describe('media proxy allowlist', () => {
  it('allows trusted HTTPS media hosts and subdomains', () => {
    assert.equal(
      isAllowedMediaUrl('https://rr1---sn-a5mekn.googlevideo.com/videoplayback?id=1'),
      true,
    )
    assert.equal(
      isAllowedMediaUrl('https://proxy.piped.private.coffee/media/abc'),
      true,
    )
  })

  it('rejects substring tricks, insecure URLs, credentials, IPs, and ports', () => {
    for (const url of [
      'https://googlevideo.com.attacker.example/video',
      'https://piped.attacker.example/video',
      'http://rr1.googlevideo.com/video',
      'https://user:pass@rr1.googlevideo.com/video',
      'https://127.0.0.1/video',
      'https://rr1.googlevideo.com:8443/video',
    ]) {
      assert.equal(isAllowedMediaUrl(url), false, url)
    }
  })
})

describe('catalog proxy allowlist', () => {
  it('accepts exact built-in API origins only', () => {
    assert.equal(isAllowedApiBase('https://api.piped.private.coffee'), true)
    assert.equal(isAllowedApiBase('https://api.piped.private.coffee/path'), false)
    assert.equal(isAllowedApiBase('https://piped.attacker.example'), false)
    assert.equal(isAllowedApiBase('http://api.piped.private.coffee'), false)
  })

  it('rejects API paths the app does not use without network access', async () => {
    const response = await handleProxy('/admin/secrets')
    assert.equal(response.status, 400)
    assert.match(response.body, /BAD_PATH/)
  })
})
