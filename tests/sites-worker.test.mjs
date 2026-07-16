import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../sites/worker.mjs'

function assetEnv() {
  const calls = []
  return {
    calls,
    env: {
      ASSETS: {
        async fetch(request) {
          const path = new URL(request.url).pathname
          calls.push(path)
          if (path === '/index.html') {
            return new Response('<main>TubePWA</main>', {
              headers: { 'Content-Type': 'text/html' },
            })
          }
          if (path === '/assets/app.js') {
            return new Response('export {}', {
              headers: { 'Content-Type': 'text/javascript' },
            })
          }
          return new Response('missing', { status: 404 })
        },
      },
    },
  }
}

describe('Sites worker', () => {
  it('serves emitted static assets directly', async () => {
    const { env, calls } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/assets/app.js'),
      env,
    )
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'export {}')
    assert.deepEqual(calls, ['/assets/app.js'])
  })

  it('falls back to index.html for browser routes', async () => {
    const { env, calls } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/library', {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      }),
      env,
    )
    assert.equal(response.status, 200)
    assert.match(await response.text(), /TubePWA/)
    assert.deepEqual(calls, ['/library', '/index.html'])
  })

  it('does not turn missing asset requests into HTML', async () => {
    const { env } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/assets/missing.js', {
        headers: { Accept: 'text/javascript' },
      }),
      env,
    )
    assert.equal(response.status, 404)
  })

  it('rejects unsafe catalog paths before making an upstream request', async () => {
    const { env } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/api/proxy?path=https://evil.example'),
      env,
    )
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'BAD_PATH')
  })

  it('rejects missing or unsafe media URLs', async () => {
    const { env } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/api/media?url=https://evil.example/video'),
      env,
    )
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'BAD_MEDIA_URL')
  })

  it('answers API preflight requests without touching assets', async () => {
    const { env, calls } = assetEnv()
    const response = await worker.fetch(
      new Request('https://tube.example/api/media', { method: 'OPTIONS' }),
      env,
    )
    assert.equal(response.status, 204)
    assert.match(response.headers.get('access-control-allow-methods'), /GET/)
    assert.deepEqual(calls, [])
  })
})
