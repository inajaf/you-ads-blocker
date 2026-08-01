'use strict'

// Shared builder for the per-tab right-click (context) menu. Kept framework-free
// so it can be unit-tested; main.js maps the returned items onto Electron Menu
// items and actions.
//
// Chrome-like conventions: a right-click on an allowed link offers "Open in New
// Tab", matching the app's other new-tab gestures (Cmd/Ctrl+click, middle-click,
// window.open). Right-click otherwise behaves like a normal browser menu
// (copy / back / forward / reload).

function buildContextMenuItems(params, options) {
  const isAllowedUrl = options.isAllowedUrl
  const canGoBack = options.canGoBack === true
  const canGoForward = options.canGoForward === true

  const linkURL = typeof params.linkURL === 'string' ? params.linkURL : ''
  const selectionText =
    typeof params.selectionText === 'string' ? params.selectionText : ''

  const items = []
  if (linkURL && isAllowedUrl(linkURL)) {
    items.push({ id: 'open-in-new-tab', label: 'Open in New Tab' })
  }
  if (linkURL) {
    items.push({ id: 'copy-link', label: 'Copy Link Address' })
  }
  if (selectionText) {
    items.push({ id: 'copy-selection', label: 'Copy' })
  }
  if (items.length > 0) {
    items.push({ type: 'separator' })
  }
  items.push(
    { id: 'back', label: 'Back', enabled: canGoBack },
    { id: 'forward', label: 'Forward', enabled: canGoForward },
    { id: 'reload', label: 'Reload' },
  )
  return items
}

module.exports = { buildContextMenuItems }
