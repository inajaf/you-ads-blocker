import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterCatalogVideos,
  normalizeCatalogPayload,
  orderCatalogVodFirst,
  isLiveCatalogItem,
  partitionLive,
  catalogVideoId,
} from '../src/api/catalog.ts'

describe('filterCatalogVideos', () => {
  it('keeps normal VODs and music/shorts, drops bare channels', () => {
    const items = [
      {
        url: '/watch?v=dQw4w9WgXcQ',
        type: 'stream',
        title: 'Rick',
        thumbnail: 't.jpg',
        uploaderName: 'A',
        duration: 212,
        views: 1,
      },
      {
        url: '/channel/UCxxxx',
        type: 'channel',
        title: 'Some Channel',
        thumbnail: 'c.jpg',
        uploaderName: 'C',
        duration: 0,
        views: 0,
      },
      {
        url: '/watch?v=kJQP7kiw5Fk',
        type: 'music_video',
        title: 'Despacito',
        thumbnail: 'd.jpg',
        uploaderName: 'L',
        duration: 282,
        views: 9,
      },
      {
        url: '/shorts/abcde123456',
        type: 'short',
        title: 'Short',
        thumbnail: 's.jpg',
        uploaderName: 'S',
        duration: 30,
        views: 2,
      },
      {
        url: '/watch?v=liveLive001',
        type: 'stream',
        title: 'Live now',
        thumbnail: 'l.jpg',
        uploaderName: 'X',
        duration: -1,
        views: 100,
      },
      {
        // no type — still a video
        url: '/watch?v=xxxxxxxxxxx',
        title: 'No type',
        thumbnail: 'n.jpg',
        uploaderName: 'N',
        duration: 90,
        views: 3,
      },
    ]
    const out = filterCatalogVideos(items)
    const ids = out.map((i) => catalogVideoId(i))
    assert.ok(ids.includes('dQw4w9WgXcQ'))
    assert.ok(ids.includes('kJQP7kiw5Fk'))
    assert.ok(ids.includes('abcde123456'))
    assert.ok(ids.includes('liveLive001') || ids.includes('xxxxxxxxxxx') || out.length >= 4)
    assert.equal(
      out.some((i) => i.type === 'channel' && !catalogVideoId(i)),
      false,
    )
    // music_video kept even though type !== stream
    assert.ok(out.some((i) => i.title === 'Despacito'))
    assert.ok(out.some((i) => i.title === 'No type'))
  })

  it('does not require type===stream only', () => {
    const out = filterCatalogVideos([
      {
        url: '/watch?v=AAAAAAAAAAA',
        type: 'video',
        title: 'V',
        thumbnail: '',
        uploaderName: '',
        duration: 10,
        views: 0,
      },
    ])
    assert.equal(out.length, 1)
  })
})

describe('orderCatalogVodFirst / live', () => {
  it('puts VOD before live', () => {
    const items = [
      {
        url: '/watch?v=liveLive001',
        title: 'L',
        thumbnail: '',
        uploaderName: '',
        duration: -1,
        views: 0,
      },
      {
        url: '/watch?v=vodVodVod01',
        title: 'V',
        thumbnail: '',
        uploaderName: '',
        duration: 100,
        views: 0,
      },
    ]
    const ordered = orderCatalogVodFirst(items)
    assert.equal(ordered[0].title, 'V')
    assert.ok(isLiveCatalogItem(items[0]))
    const { vod, live } = partitionLive(items)
    assert.equal(vod.length, 1)
    assert.equal(live.length, 1)
  })
})

describe('normalizeCatalogPayload', () => {
  it('accepts trending array and search items', () => {
    const a = normalizeCatalogPayload([
      {
        url: '/watch?v=dQw4w9WgXcQ',
        title: 'R',
        thumbnail: '',
        uploaderName: '',
        duration: 1,
        views: 0,
      },
    ])
    assert.equal(a.length, 1)
    const b = normalizeCatalogPayload({
      items: [
        {
          url: '/watch?v=kJQP7kiw5Fk',
          type: 'stream',
          title: 'D',
          thumbnail: '',
          uploaderName: '',
          duration: 1,
          views: 0,
        },
      ],
      nextpage: null,
    })
    assert.equal(b.length, 1)
  })
})
