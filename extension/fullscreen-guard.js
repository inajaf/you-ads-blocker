/**
 * Desktop-only fullscreen guard (injected by desktop/preload.js into the page
 * main world). YouTube fullscreens the <html> document on watch pages, and in
 * the Electron wrapper the transition can break in two ways:
 *
 * 1. A requestFullscreen() that races player startup hangs: no fullscreenchange
 *    ever fires, the window is left in OS fullscreen, and the video stays stuck
 *    at its windowed size.
 * 2. A fullscreen-button click during player init is ignored entirely (no
 *    request is made), so nothing happens until the user clicks again.
 *
 * Fix both: wrap requestFullscreen so a request that does not settle within a
 * short window is retried once (the retry aborts the hung request and completes
 * the transition), and watch fullscreen-button clicks so a click that produced
 * no fullscreen state within ~2s re-issues the request on the document. The
 * retries run inside the transient-activation window granted by the user's
 * click. Only the top frame is patched (chat/ads iframes must not be affected).
 */
;(() => {
  if (window.top !== window.self) return

  const RETRY_MS = 1500
  const CLICK_WATCH_MS = 2000
  const CLICK_RETRIES = 3

  // --- 1. requestFullscreen hang retry -------------------------------------
  const nativeRequestFullscreen = Element.prototype.requestFullscreen
  if (typeof nativeRequestFullscreen === 'function') {
    Element.prototype.requestFullscreen = function (...args) {
      const promise = nativeRequestFullscreen.apply(this, args)
      let settled = false
      let timer = null
      const settle = () => {
        settled = true
        if (timer) clearTimeout(timer)
      }
      promise.then(settle, settle)
      timer = setTimeout(() => {
        if (settled) return
        try {
          const retry = nativeRequestFullscreen.call(document.documentElement)
          if (retry && typeof retry.catch === 'function') retry.catch(() => {})
        } catch {
          /* ignore */
        }
      }, RETRY_MS)
      return promise
    }
  }

  // --- 2. fullscreen-button click watchdog ----------------------------------
  function requestDocumentFullscreen() {
    const el = document.documentElement
    const req = el.requestFullscreen || el.webkitRequestFullscreen
    if (typeof req !== 'function') return false
    try {
      const promise = req.call(el)
      if (promise && typeof promise.catch === 'function') promise.catch(() => {})
      return true
    } catch {
      return false
    }
  }

  let clickTimer = null
  let clickAttempts = 0
  const clearClickWatch = () => {
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }
    clickAttempts = 0
  }
  document.addEventListener('fullscreenchange', clearClickWatch)

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!target || typeof target.closest !== 'function') return
      if (!target.closest('.ytp-fullscreen-button')) return
      // Exit clicks already have a fullscreen element; only guard enter clicks.
      if (document.fullscreenElement || document.webkitFullscreenElement) return
      clearClickWatch()
      clickAttempts = 1
      clickTimer = setTimeout(function attempt() {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          clearClickWatch()
          return
        }
        if (requestDocumentFullscreen() && clickAttempts < CLICK_RETRIES) {
          clickAttempts += 1
          clickTimer = setTimeout(attempt, CLICK_WATCH_MS)
        } else {
          clearClickWatch()
        }
      }, CLICK_WATCH_MS)
    },
    true,
  )
})()
