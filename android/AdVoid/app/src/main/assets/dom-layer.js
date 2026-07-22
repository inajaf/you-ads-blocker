/**
 * DOM-layer ad handling for YouTube mobile web.
 * Ported from extension/content.js — runs in an isolated world at document-end.
 * Clicks skip buttons, speeds through unskippable ads, hides feed ads.
 */
;(() => {
  const SELECTORS_SKIP = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container',
  ]

  const SELECTORS_AD_STATE = [
    '.ad-showing',
    '.ad-interrupting',
    'div.ytp-ad-player-overlay',
    '.ytp-ad-text',
  ]

  const SELECTORS_FEED_ADS = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
  ]
  const SELECTOR_FEED_AD = SELECTORS_FEED_ADS.join(',')
  const SELECTOR_FEED_CONTAINER = 'ytd-rich-item-renderer, ytd-rich-section-renderer'
  const HIDDEN_CLASS = 'noirva-hidden-ad'

  function clickIfVisible(el) {
    if (!el) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    try { el.click(); return true } catch { return false }
  }

  function trySkip() {
    for (const sel of SELECTORS_SKIP) {
      for (const n of document.querySelectorAll(sel)) {
        if (clickIfVisible(n)) return true
      }
    }
    for (const b of document.querySelectorAll('button, .ytp-button')) {
      const t = (b.textContent || '').trim().toLowerCase()
      if (t === 'skip' || t === 'skip ad' || t === 'skip ads' || t.startsWith('skip ad')) {
        if (clickIfVisible(b)) return true
      }
    }
    return false
  }

  function speedThroughAd() {
    const video = document.querySelector('video.html5-main-video, video')
    if (!video) return
    const player = video.closest('.html5-video-player')
    const isAd =
      player?.classList.contains('ad-showing') ||
      player?.classList.contains('ad-interrupting') ||
      SELECTORS_AD_STATE.some((s) => document.querySelector(s))

    if (!isAd) {
      if (video.dataset.noirvaSpeed) {
        try {
          video.playbackRate = Number(video.dataset.noirvaSpeed) || 1
          video.muted = video.dataset.noirvaMuted === '1'
        } catch {}
        delete video.dataset.noirvaSpeed
        delete video.dataset.noirvaMuted
      }
      return
    }

    trySkip()
    try {
      if (!video.dataset.noirvaSpeed) {
        video.dataset.noirvaSpeed = String(video.playbackRate || 1)
        video.dataset.noirvaMuted = video.muted ? '1' : '0'
      }
      video.playbackRate = 16
      if (Number.isFinite(video.duration) && video.duration > 0) {
        if (video.currentTime < video.duration - 0.5) {
          video.currentTime = Math.max(0, video.duration - 0.3)
        }
      }
      video.muted = true
    } catch {}
  }

  function hideFeedAds() {
    if (!document.documentElement) return
    for (const container of document.querySelectorAll(SELECTOR_FEED_CONTAINER)) {
      if (container.querySelector(SELECTOR_FEED_AD)) {
        container.classList.add(HIDDEN_CLASS)
        container.style.display = 'none'
      }
    }
  }

  function tick() {
    trySkip()
    speedThroughAd()
    hideFeedAds()
  }

  setInterval(tick, 400)

  const mo = new MutationObserver(tick)
  function startObs() {
    if (!document.documentElement) return
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    hideFeedAds()
  }

  if (document.documentElement) startObs()
  else document.addEventListener('DOMContentLoaded', startObs)

  let lastHref = location.href
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href
      setTimeout(tick, 300)
    }
  }, 800)

  console.info('[Noirva] DOM layer active')
})()
