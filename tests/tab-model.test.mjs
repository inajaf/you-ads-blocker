import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import tabModel from '../desktop/tab-model.js'

const {
  DEFAULT_TITLE,
  HOME_URL,
  createTabModel,
  isVideoOpenUrl,
  isYouTubeUrl,
} = tabModel

function openHome(model) {
  return model.openTab(HOME_URL)
}

describe('AdVoid desktop tab model', () => {
  it('opens a first tab that becomes active', () => {
    const model = createTabModel()
    const { tab, created } = openHome(model)

    assert.equal(created, true)
    assert.equal(tab.id, 1)
    assert.equal(tab.url, HOME_URL)
    assert.equal(model.activeId, 1)
    assert.equal(model.getActiveTab().id, 1)
    assert.equal(model.getTabs().length, 1)
  })

  it('assigns incrementing ids and tracks an active tab', () => {
    const model = createTabModel()
    openHome(model)
    const video = model.openTab('https://www.youtube.com/watch?v=first')
    const another = model.openTab('https://www.youtube.com/watch?v=second')

    assert.equal(video.tab.id, 2)
    assert.equal(another.tab.id, 3)
    assert.equal(model.activeId, 3)
    assert.deepEqual(
      model.getTabs().map((tab) => tab.id),
      [1, 2, 3],
    )
  })

  it('falls back to the home URL when opened with no URL', () => {
    const model = createTabModel()
    const { tab } = model.openTab()

    assert.equal(tab.url, HOME_URL)
  })

  it('deduplicates tabs already open at the same URL instead of duplicating', () => {
    const model = createTabModel()
    openHome(model)
    const first = model.openTab('https://www.youtube.com/watch?v=same')
    assert.equal(first.created, true)

    const second = model.openTab('https://www.youtube.com/watch?v=same')
    assert.equal(second.created, false)
    assert.equal(second.tab.id, first.tab.id)
    assert.equal(model.getTabs().length, 2)
    assert.equal(model.activeId, first.tab.id)
  })

  it('forces a duplicate tab when forceNew is requested (new-tab button)', () => {
    const model = createTabModel()
    openHome(model)
    const forced = model.openTab(HOME_URL, { forceNew: true })

    assert.equal(forced.created, true)
    assert.notEqual(forced.tab.id, 1)
    assert.equal(model.getTabs().length, 2)
    assert.equal(model.activeId, forced.tab.id)
  })

  it('selects an existing tab and rejects unknown ids', () => {
    const model = createTabModel()
    const first = openHome(model)
    model.openTab('https://www.youtube.com/watch?v=x')

    assert.equal(model.selectTab(first.tab.id), true)
    assert.equal(model.activeId, first.tab.id)
    assert.equal(model.selectTab(999), false)
    assert.equal(model.activeId, first.tab.id)
  })

  it('keeps the active tab when a non-active tab is closed', () => {
    const model = createTabModel()
    openHome(model)
    const video = model.openTab('https://www.youtube.com/watch?v=x', { activate: false })

    assert.notEqual(video.tab.id, model.activeId)
    assert.equal(model.activeId, 1)
    model.closeTab(video.tab.id)

    assert.equal(model.getTabs().length, 1)
    assert.equal(model.activeId, 1)
  })

  it('activates the right neighbour when the active tab is closed', () => {
    const model = createTabModel()
    openHome(model)
    model.openTab('https://www.youtube.com/watch?v=a')
    const middle = model.openTab('https://www.youtube.com/watch?v=b')
    model.openTab('https://www.youtube.com/watch?v=c')
    model.selectTab(middle.tab.id)

    model.closeTab(middle.tab.id)

    assert.deepEqual(
      model.getTabs().map((tab) => tab.url),
      [
        HOME_URL,
        'https://www.youtube.com/watch?v=a',
        'https://www.youtube.com/watch?v=c',
      ],
    )
    assert.equal(model.activeId, 4)
  })

  it('activates the left neighbour when the last tab is closed', () => {
    const model = createTabModel()
    openHome(model)
    const last = model.openTab('https://www.youtube.com/watch?v=z')

    model.closeTab(last.tab.id)

    assert.equal(model.getTabs().length, 1)
    assert.equal(model.activeId, 1)
  })

  it('reports empty after the only tab is closed', () => {
    const model = createTabModel()
    const only = openHome(model)

    assert.equal(model.isEmpty(), false)
    model.closeTab(only.tab.id)

    assert.equal(model.isEmpty(), true)
    assert.equal(model.getActiveTab(), null)
  })

  it('updates title, url and loading flags without touching other tabs', () => {
    const model = createTabModel()
    openHome(model)
    const video = model.openTab('https://www.youtube.com/watch?v=x')

    assert.equal(model.setTitle(video.tab.id, '  My Video  '), true)
    assert.equal(model.getTab(video.tab.id).title, 'My Video')
    assert.equal(model.setTitle(video.tab.id, ''), true)
    assert.equal(model.getTab(video.tab.id).title, DEFAULT_TITLE)
    assert.equal(model.setTitle(999, 'nope'), false)

    assert.equal(model.setUrl(video.tab.id, 'https://www.youtube.com/watch?v=y'), true)
    assert.equal(model.getTab(video.tab.id).url, 'https://www.youtube.com/watch?v=y')

    assert.equal(model.setLoading(video.tab.id, true), true)
    assert.equal(model.getTab(video.tab.id).loading, true)
    assert.equal(model.getTab(1).loading, true)
  })

  it('recognizes YouTube watch and shorts URLs as video opens', () => {
    assert.equal(isVideoOpenUrl('https://www.youtube.com/watch?v=abc123'), true)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/watch?v=abc123&list=PL1&index=2'), true)
    assert.equal(isVideoOpenUrl('https://m.youtube.com/watch?v=abc123'), true)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/shorts/abc123'), true)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/shorts/abc123/'), true)

    assert.equal(isVideoOpenUrl('https://www.youtube.com/'), false)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/@channel'), false)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/results?search_query=x'), false)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/watch'), false)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/shorts'), false)
    assert.equal(isVideoOpenUrl('https://www.youtube.com/shorts/'), false)
    assert.equal(isVideoOpenUrl('https://example.com/watch?v=abc'), false)
    assert.equal(isVideoOpenUrl('http://www.youtube.com/watch?v=abc'), false)
    assert.equal(isVideoOpenUrl('not-a-url'), false)
  })

  it('recognizes YouTube hosts while rejecting lookalikes', () => {
    assert.equal(isYouTubeUrl('https://www.youtube.com/'), true)
    assert.equal(isYouTubeUrl('https://youtube.com/'), true)
    assert.equal(isYouTubeUrl('https://studio.youtube.com/'), true)
    assert.equal(isYouTubeUrl('https://m.youtube.com/watch?v=x'), true)

    assert.equal(isYouTubeUrl('https://youtube.com.attacker.test/'), false)
    assert.equal(isYouTubeUrl('https://www.youtube.com.evil.com/'), false)
    assert.equal(isYouTubeUrl('http://www.youtube.com/'), false)
    assert.equal(isYouTubeUrl('javascript:alert(1)'), false)
    assert.equal(isYouTubeUrl(''), false)
  })
})
