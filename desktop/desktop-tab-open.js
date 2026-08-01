/**
 * In-page helper for the AdVoid desktop app: opens a YouTube video link in a NEW
 * tab only for explicit "new tab" intents, matching Chrome conventions — a
 * Cmd/Ctrl+click or a middle-click (plus the context-menu "open in new tab"
 * affordance, which Chromium routes through window.open). A plain single click
 * is left untouched so YouTube's SPA navigates the current tab.
 *
 * Runs in Electron's isolated preload world, where trusted DOM input can be
 * forwarded without exposing a page-world event bridge.
 *
 * The pure URL/click logic is exported for node:test via a vm context.
 */
;(function installDesktopTabOpen(global) {
  function isYouTubeUrl(rawUrl) {
    let url
    try {
      url = new URL(rawUrl)
    } catch {
      return false
    }
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return host === 'youtube.com' || host.endsWith('.youtube.com')
  }

  function isVideoUrl(rawUrl) {
    let url
    try {
      url = new URL(rawUrl)
    } catch {
      return false
    }
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return false
    if (url.pathname === '/watch' || url.pathname.startsWith('/watch/')) {
      return url.searchParams.has('v')
    }
    return /^\/shorts\/.+/.test(url.pathname)
  }

  function hrefToUrl(href, base) {
    try {
      return new URL(href, base)
    } catch {
      return null
    }
  }

  function closestAnchor(target) {
    let node = target
    while (node && node !== global.document) {
      if (
        node &&
        node.tagName === 'A' &&
        typeof node.hasAttribute === 'function' &&
        node.hasAttribute('href')
      ) {
        return node
      }
      node = node && node.parentNode
    }
    return null
  }

  // Only explicit new-tab gestures are ours: middle-click, or a Cmd/Ctrl+click.
  // Plain, Shift/Alt-modified and right-click (context menu) fall through.
  function wantsNewTab(event) {
    if (event.button === 1) return true
    if (event.button !== 0) return false
    if (event.shiftKey || event.altKey) return false
    return event.metaKey || event.ctrlKey
  }

  function handleClick(event) {
    if (!event.isTrusted || !wantsNewTab(event)) return

    const anchor = closestAnchor(event.target)
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href) return

    const url = hrefToUrl(href, global.location && global.location.href)
    if (!url || !isVideoUrl(url.href)) return

    event.preventDefault()
    event.stopPropagation()
    return url.href
  }

  function register(globalScope, openUrl) {
    if (
      !globalScope.document ||
      typeof globalScope.document.addEventListener !== 'function'
    ) {
      return
    }
    // 'click' covers Cmd/Ctrl+click (primary button); 'auxclick' covers
    // middle-click (button 1).
    const onClick = (event) => {
      const url = handleClick(event)
      if (url) openUrl(url)
    }
    globalScope.document.addEventListener('click', onClick, true)
    globalScope.document.addEventListener('auxclick', onClick, true)
  }

  global.NoirvaDesktopTabOpen = Object.freeze({
    handleClick,
    isVideoUrl,
    isYouTubeUrl,
    register,
  })
})(globalThis)

// The preload requires this file as a Node module; the page main world has no
// `module`, so the same source doubles as a browser content script.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.NoirvaDesktopTabOpen
}
