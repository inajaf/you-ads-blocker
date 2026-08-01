import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import contextMenu from '../desktop/tab-context-menu.js'
import tabModel from '../desktop/tab-model.js'

const { buildContextMenuItems } = contextMenu
const { isVideoOpenUrl } = tabModel

function ids(items) {
  return items.map((item) => item.id || item.type)
}

describe('desktop tab context menu', () => {
  it('offers "Open in New Tab" first for a video link right-click', () => {
    const items = buildContextMenuItems(
      { linkURL: 'https://www.youtube.com/watch?v=abc', selectionText: '' },
      { isVideoUrl: isVideoOpenUrl },
    )

    assert.deepEqual(ids(items).slice(0, 3), [
      'open-in-new-tab',
      'copy-link',
      'separator',
    ])
    assert.equal(items[0].label, 'Open in New Tab')
  })

  it('does not offer "Open in New Tab" for non-video links', () => {
    const items = buildContextMenuItems(
      { linkURL: 'https://www.youtube.com/@somechannel', selectionText: '' },
      { isVideoUrl: isVideoOpenUrl },
    )

    assert.equal(ids(items).includes('open-in-new-tab'), false)
    assert.equal(ids(items).includes('copy-link'), true)
  })

  it('includes Copy for a text selection', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: 'selected words' },
      { isVideoUrl: isVideoOpenUrl },
    )

    assert.deepEqual(ids(items).slice(0, 2), ['copy-selection', 'separator'])
  })

  it('reflects back/forward availability in the navigation items', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: '' },
      { isVideoUrl: isVideoOpenUrl, canGoBack: true, canGoForward: false },
    )

    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    assert.equal(byId.back.enabled, true)
    assert.equal(byId.forward.enabled, false)
    assert.equal(byId.reload.enabled, undefined)
  })

  it('always ends with navigation items and omits the leading separator when bare', () => {
    const items = buildContextMenuItems(
      { linkURL: '', selectionText: '' },
      { isVideoUrl: isVideoOpenUrl },
    )

    assert.deepEqual(ids(items), ['back', 'forward', 'reload'])
  })

  it('treats a missing/invalid linkURL as no link', () => {
    const noLink = buildContextMenuItems(
      {},
      { isVideoUrl: isVideoOpenUrl },
    )
    const badLink = buildContextMenuItems(
      { linkURL: 42 },
      { isVideoUrl: isVideoOpenUrl },
    )

    assert.equal(ids(noLink).includes('copy-link'), false)
    assert.equal(ids(badLink).includes('copy-link'), false)
  })
})
