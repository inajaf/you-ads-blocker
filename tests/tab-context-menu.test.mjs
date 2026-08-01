import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import contextMenu from '../desktop/tab-context-menu.js'
import tabModel from '../desktop/tab-model.js'

const { buildContextMenuItems } = contextMenu
const { isYouTubeUrl } = tabModel

function ids(items) {
  return items.map((item) => item.id || item.type)
}

describe('desktop tab context menu', () => {
  it('offers "Open in New Tab" first for a video link right-click', () => {
    const items = buildContextMenuItems(
      { linkURL: 'https://www.youtube.com/watch?v=abc', selectionText: '' },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.deepEqual(ids(items).slice(0, 3), [
      'open-in-new-tab',
      'copy-link',
      'separator',
    ])
    assert.equal(items[0].label, 'Open in New Tab')
  })

  it('offers "Open in New Tab" for other allowed YouTube links', () => {
    const items = buildContextMenuItems(
      { linkURL: 'https://www.youtube.com/@somechannel', selectionText: '' },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.equal(ids(items).includes('open-in-new-tab'), true)
    assert.equal(ids(items).includes('copy-link'), true)
  })

  it('includes Copy for a text selection', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: 'selected words' },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.deepEqual(ids(items).slice(0, 2), ['copy-selection', 'separator'])
  })

  it('reflects back/forward availability in the navigation items', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: '' },
      { isAllowedUrl: isYouTubeUrl, canGoBack: true, canGoForward: false },
    )

    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    assert.equal(byId.back.enabled, true)
    assert.equal(byId.forward.enabled, false)
    assert.equal(byId.reload.enabled, undefined)
  })

  it('always ends with navigation items and omits the leading separator when bare', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: '' },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.deepEqual(ids(items), ['back', 'forward', 'reload'])
  })

  it('treats a missing/invalid linkURL as no link', () => {
    const noLink = buildContextMenuItems(
      {},
      { isAllowedUrl: isYouTubeUrl },
    )
    const badLink = buildContextMenuItems(
      { linkURL: 42 },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.equal(ids(noLink).includes('copy-link'), false)
    assert.equal(ids(badLink).includes('copy-link'), false)
  })

  it('does not offer "Open in New Tab" for external links', () => {
    const items = buildContextMenuItems(
      { linkURL: 'https://example.com/video', selectionText: '' },
      { isAllowedUrl: isYouTubeUrl },
    )

    assert.equal(ids(items).includes('open-in-new-tab'), false)
    assert.equal(ids(items).includes('copy-link'), true)
  })
})
