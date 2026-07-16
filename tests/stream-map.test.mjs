import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapInnerTubePlayerResponse,
  mapInvidiousVideo,
  hasPlayableSources,
  mapFormat,
  rankStreamsForBrowser,
  browserPlayScore,
  streamBrowserScore,
} from '../server/stream-map.mjs'
import {
  buildSources,
  hasPlayerSources,
  pickDefaultSourceIndex,
  streamBrowserScore as clientScore,
} from '../src/player/sources.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))

describe('mapInnerTubePlayerResponse', () => {
  it('maps a fixture VOD player response to playable streams', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dir, 'fixtures/innertube-vod.json'), 'utf8'),
    )
    const mapped = mapInnerTubePlayerResponse(fixture, 'dQw4w9WgXcQ')
    assert.ok(mapped)
    assert.equal(mapped.title, 'Never Gonna Give You Up')
    assert.ok(hasPlayableSources(mapped))
    assert.ok(mapped.videoStreams.length >= 1)
    assert.ok(mapped.videoStreams[0].url.includes('googlevideo.com'))

    const sources = buildSources(mapped)
    assert.ok(sources.length >= 1)
    assert.ok(hasPlayerSources(mapped))
  })

  it('returns null for non-OK playability', () => {
    const mapped = mapInnerTubePlayerResponse(
      { playabilityStatus: { status: 'LOGIN_REQUIRED' }, streamingData: {} },
      'x',
    )
    assert.equal(mapped, null)
  })
})

describe('mapInvidiousVideo', () => {
  it('maps formatStreams to videoStreams', () => {
    const data = {
      title: 'Test VOD',
      author: 'Author',
      authorId: 'UCxxxxxxxxxxxxxxxxxxxxxx',
      lengthSeconds: 120,
      viewCount: 50,
      liveNow: false,
      formatStreams: [
        {
          url: 'https://example.com/v.mp4',
          type: 'video/mp4; codecs="avc1,mp4a"',
          qualityLabel: '360p',
          quality: 'medium',
        },
      ],
      adaptiveFormats: [
        {
          url: 'https://example.com/a.m4a',
          type: 'audio/mp4',
          bitrate: 128000,
        },
      ],
      videoThumbnails: [{ quality: 'medium', url: 'https://example.com/t.jpg' }],
    }
    const mapped = mapInvidiousVideo(data, 'dQw4w9WgXcQ')
    assert.ok(mapped)
    assert.equal(mapped.title, 'Test VOD')
    assert.ok(hasPlayableSources(mapped))
    assert.equal(mapped.videoStreams[0].url, 'https://example.com/v.mp4')
    assert.ok(mapped.audioStreams.length >= 1)
  })
})

describe('mapFormat', () => {
  it('sets videoOnly flag', () => {
    const f = mapFormat(
      { url: 'http://x', mimeType: 'video/mp4', qualityLabel: '720p', height: 720 },
      true,
    )
    assert.equal(f.videoOnly, true)
    assert.equal(f.quality, '720p')
  })
})

describe('browser ranking (LBRY vs videoplayback)', () => {
  it('prefers googlevideo/proxy over odycdn progressive', () => {
    const payload = {
      title: 't',
      videoStreams: [
        {
          url: 'https://player.odycdn.com/v6/streams/x.mp4',
          mimeType: 'video/mp4',
          quality: 'LBRY',
          videoOnly: false,
        },
        {
          url: 'https://proxy.piped.private.coffee/videoplayback?id=1',
          mimeType: 'video/mp4',
          quality: '360p',
          videoOnly: false,
          height: 360,
        },
        {
          url: 'https://rr1---sn-xxx.googlevideo.com/videoplayback?id=2',
          mimeType: 'video/mp4',
          quality: '720p',
          videoOnly: false,
          height: 720,
        },
      ],
      audioStreams: [],
      hls: null,
    }
    const ranked = rankStreamsForBrowser(payload)
    assert.ok(browserPlayScore(ranked) >= 40)
    assert.ok(
      /googlevideo|videoplayback/.test(ranked.videoStreams[0].url),
      `first should be browser-playable, got ${ranked.videoStreams[0].url}`,
    )
    assert.ok(streamBrowserScore(payload.videoStreams[0]) < streamBrowserScore(payload.videoStreams[2]))

    const sources = buildSources(ranked)
    assert.ok(sources.length >= 1)
    assert.ok(
      /googlevideo|videoplayback|proxy\.piped/.test(sources[0].url),
      `buildSources first should not be odycdn mp4, got ${sources[0].url}`,
    )
    assert.ok(clientScore(payload.videoStreams[2]) > clientScore(payload.videoStreams[0]))
  })

  it('treats LBRY HLS mime as hls kind in buildSources', () => {
    const sources = buildSources({
      title: 't',
      description: '',
      uploadDate: '',
      uploader: '',
      uploaderUrl: '',
      thumbnailUrl: '',
      hls: null,
      duration: 1,
      views: 0,
      likes: 0,
      audioStreams: [],
      relatedStreams: [],
      subtitles: [],
      videoStreams: [
        {
          url: 'https://player.odycdn.com/v6/streams/hls',
          mimeType: 'application/x-mpegurl',
          quality: 'LBRY HLS',
          videoOnly: false,
        },
      ],
    })
    assert.equal(sources[0].kind, 'hls')
  })

  it('prefers max height including adaptive 1080 when muxed is only 360', () => {
    const payload = {
      title: 't',
      description: '',
      uploadDate: '',
      uploader: '',
      uploaderUrl: '',
      thumbnailUrl: '',
      hls: null,
      duration: 1,
      views: 0,
      likes: 0,
      relatedStreams: [],
      subtitles: [],
      audioStreams: [
        {
          url: 'https://rr1---sn-x.googlevideo.com/videoplayback?audio=1',
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          quality: '128kbps',
          videoOnly: false,
          bitrate: 128000,
        },
      ],
      videoStreams: [
        {
          url: 'https://rr1---sn-x.googlevideo.com/videoplayback?mux=360',
          mimeType: 'video/mp4',
          quality: '360p',
          videoOnly: false,
          height: 360,
        },
        {
          url: 'https://rr1---sn-x.googlevideo.com/videoplayback?v=720',
          mimeType: 'video/mp4; codecs="avc1.4d401f"',
          quality: '720p',
          videoOnly: true,
          height: 720,
        },
        {
          url: 'https://rr1---sn-x.googlevideo.com/videoplayback?v=1080',
          mimeType: 'video/mp4; codecs="avc1.640028"',
          quality: '1080p',
          videoOnly: true,
          height: 1080,
        },
      ],
    }
    const sources = buildSources(payload)
    const labels = sources.map((s) => s.label)
    assert.ok(labels.includes('1080p'), `got ${labels}`)
    assert.ok(labels.includes('720p'), `got ${labels}`)
    assert.ok(labels.includes('360p'), `got ${labels}`)
    assert.equal(sources[0].height, 1080)
    assert.equal(sources[0].kind, 'adaptive')
    assert.ok(sources[0].audioUrl)
    // Stream autoplay prefers progressive (not adaptive 1080 hang)
    const def = pickDefaultSourceIndex(sources)
    assert.equal(sources[def].kind, 'progressive')
    assert.equal(sources[def].height, 360)
    assert.ok(sources.some((s) => s.height === 1080 && s.kind === 'adaptive'))
  })
})
