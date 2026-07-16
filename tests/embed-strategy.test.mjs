import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmbedUrl,
  buildPlayerVars,
  nextEmbedAction,
  isHttpsPage,
} from '../src/player/embedStrategy.ts'

describe('buildEmbedUrl', () => {
  it('uses youtube.com/embed as primary host without origin on http', () => {
    const url = buildEmbedUrl('dQw4w9WgXcQ', {
      host: 'youtube',
      startSec: 12,
      enableJsApi: true,
      pageProtocol: 'http:',
      pageOrigin: 'http://127.0.0.1:5173',
    })
    assert.match(url, /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?/)
    assert.match(url, /start=12/)
    assert.match(url, /enablejsapi=1/)
    assert.doesNotMatch(url, /origin=/)
  })

  it('attaches origin only on https pages', () => {
    const url = buildEmbedUrl('dQw4w9WgXcQ', {
      host: 'youtube',
      enableJsApi: true,
      pageProtocol: 'https:',
      pageOrigin: 'https://app.example.com',
    })
    assert.match(url, /origin=https%3A%2F%2Fapp.example.com/)
  })

  it('supports nocookie host', () => {
    const url = buildEmbedUrl('aaaaaaaaaaa', { host: 'nocookie' })
    assert.match(url, /^https:\/\/www\.youtube-nocookie\.com\/embed\//)
  })
})

describe('buildPlayerVars', () => {
  it('omits origin on non-https', () => {
    const v = buildPlayerVars(0, 'http:', 'http://127.0.0.1:5173')
    assert.equal(v.origin, undefined)
    assert.equal(v.autoplay, 1)
  })

  it('sets origin on https', () => {
    const v = buildPlayerVars(9, 'https:', 'https://x.test')
    assert.equal(v.origin, 'https://x.test')
    assert.equal(v.start, 9)
  })
})

describe('nextEmbedAction', () => {
  it('falls back to stream on embed-disabled after host retry', () => {
    const first = nextEmbedAction(150, 'youtube', false)
    assert.equal(first.action, 'retry_host')
    assert.equal(first.host, 'nocookie')
    const second = nextEmbedAction(150, 'nocookie', true)
    assert.equal(second.action, 'stream_fallback')
  })

  it('streams immediately on not found', () => {
    const r = nextEmbedAction(100, 'youtube', false)
    assert.equal(r.action, 'stream_fallback')
  })

  it('retries host once on 153 then streams', () => {
    const a = nextEmbedAction(153, 'youtube', false)
    assert.equal(a.action, 'retry_host')
    const b = nextEmbedAction(153, 'nocookie', true)
    assert.equal(b.action, 'stream_fallback')
  })
})

describe('isHttpsPage', () => {
  it('detects https', () => {
    assert.equal(isHttpsPage('https:'), true)
    assert.equal(isHttpsPage('http:'), false)
  })
})
