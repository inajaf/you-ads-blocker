/**
 * Isolated world: skip buttons, observers, CSS helpers.
 * Works like classic YouTube adblock extensions — on real youtube.com.
 * No API keys. User stays signed in to their Google account in Chrome.
 */

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
const HIDDEN_FEED_CONTAINER_CLASS = 'tube-hidden-ad-container'

const STATE_EVENT = 'yt-ads-shield:state'
let shieldEnabled = false

const DESKTOP_APP_KEY = 'tube.desktopAppMode'
const DESKTOP_GUIDE_STORAGE_KEY = 'tube.desktopGuideVersion'
const DESKTOP_GUIDE_HANDOFF_PARAM = 'tube_guide'
const DESKTOP_APP_WINDOW_MESSAGE = 'REGISTER_DESKTOP_APP_WINDOW'
const DESKTOP_APP_HEARTBEAT_MS = 15_000
const desktopGuide = globalThis.TubeDesktopGuide
const desktopGuideUI = globalThis.TubeDesktopGuideUI
const maintenanceModel = globalThis.NoirvaMaintenance
let desktopGuideInstalled = false
let desktopWindowRegistrationPending = false
let desktopWindowLastConfirmedAt = 0
let adContainerCleanupScheduled = false

function isDesktopAppMode() {
  if (new URLSearchParams(location.search).get('tube_app') === '1') {
    try {
      sessionStorage.setItem(DESKTOP_APP_KEY, '1')
    } catch {
      /* ignore */
    }
    return true
  }
  try {
    return sessionStorage.getItem(DESKTOP_APP_KEY) === '1'
  } catch {
    return false
  }
}

function applyDesktopAppChrome() {
  const enabled = isDesktopAppMode()
  document.documentElement?.classList.toggle('tube-desktop-app', enabled)
  return enabled
}

function collapseFeedAdContainers() {
  adContainerCleanupScheduled = false
  if (!document.documentElement) return

  const containers = document.querySelectorAll(
    `${SELECTOR_FEED_CONTAINER}, .${HIDDEN_FEED_CONTAINER_CLASS}`,
  )
  for (const container of containers) {
    const containsAd = Boolean(container.querySelector(SELECTOR_FEED_AD))
    const content = container.matches('ytd-rich-item-renderer')
      ? container.querySelector(':scope > #content')
      : null
    // When Shield blocks an ad request before YouTube creates its ad custom
    // element, the rich item survives with an empty #content node. These are
    // the repeating blank cells visible in the Home feed (for example every
    // seventh item in the current renderer). Unhide it automatically if
    // YouTube later recycles the node and inserts real content.
    const isOrphanedEmptyItem = Boolean(content && content.childElementCount === 0)
    container.classList.toggle(
      HIDDEN_FEED_CONTAINER_CLASS,
      containsAd || isOrphanedEmptyItem,
    )
  }
}

function scheduleFeedAdContainerCleanup() {
  if (adContainerCleanupScheduled) return
  adContainerCleanupScheduled = true
  requestAnimationFrame(collapseFeedAdContainers)
}

function registerDesktopAppWindow() {
  if (
    desktopWindowRegistrationPending ||
    window.top !== window ||
    !applyDesktopAppChrome() ||
    Date.now() - desktopWindowLastConfirmedAt < DESKTOP_APP_HEARTBEAT_MS
  ) {
    return
  }

  desktopWindowRegistrationPending = true
  let registrationTimeoutId
  Promise.race([
    chrome.runtime.sendMessage({ type: DESKTOP_APP_WINDOW_MESSAGE }),
    new Promise((_, reject) => {
      registrationTimeoutId = setTimeout(
        () => reject(new Error('desktop app window registration timed out')),
        600,
      )
    }),
  ])
    .then((response) => {
      if (response?.registered) {
        desktopWindowLastConfirmedAt = Date.now()
        return
      }
      desktopWindowLastConfirmedAt = 0
      console.error('[Noirva] desktop app window registration was rejected')
    })
    .catch((error) => {
      desktopWindowLastConfirmedAt = 0
      console.error('[Noirva] failed to register the desktop app window:', error)
    })
    .finally(() => {
      clearTimeout(registrationTimeoutId)
      desktopWindowRegistrationPending = false
    })
}

function ensureDesktopGuide() {
  if (
    desktopGuideInstalled ||
    !desktopGuide ||
    !desktopGuideUI ||
    window.top !== window ||
    !isDesktopAppMode()
  ) {
    return
  }

  desktopGuideInstalled = true
  const storage = {
    async getCompletedVersion() {
      const cfg = await chrome.storage.local.get({ [DESKTOP_GUIDE_STORAGE_KEY]: 0 })
      return cfg[DESKTOP_GUIDE_STORAGE_KEY]
    },
    async setCompletedVersion(version) {
      await chrome.storage.local.set({ [DESKTOP_GUIDE_STORAGE_KEY]: version })
    },
  }
  const maintenance = {
    async clear(action) {
      if (!maintenanceModel) throw new Error('Noirva maintenance service is unavailable')
      const response = await chrome.runtime.sendMessage({
        type: maintenanceModel.MAINTENANCE_MESSAGE,
        action,
      })
      if (!response?.ok) {
        throw new Error(response?.error || 'Noirva could not clear browsing data')
      }
      return response
    },
  }

  void (async () => {
    const currentUrl = new URL(location.href)
    if (currentUrl.searchParams.get(DESKTOP_GUIDE_HANDOFF_PARAM) === 'done') {
      await storage.setCompletedVersion(desktopGuide.VERSION)
      currentUrl.searchParams.delete(DESKTOP_GUIDE_HANDOFF_PARAM)
      history.replaceState(history.state, '', currentUrl)
    }
    desktopGuideUI.install({
      guide: desktopGuide,
      storage,
      maintenance,
      logoUrl: chrome.runtime.getURL('icons/noirva-logo-v2-128.png'),
    })
  })().catch((error) => {
    desktopGuideInstalled = false
    console.error('[Noirva] failed to initialize desktop guide:', error)
  })
}

function publishState() {
  window.dispatchEvent(
    new CustomEvent(STATE_EVENT, {
      detail: { enabled: shieldEnabled },
    }),
  )
}

chrome.storage.sync.get({ enabled: true }, (cfg) => {
  shieldEnabled = cfg.enabled !== false
  publishState()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.enabled) return
  shieldEnabled = changes.enabled.newValue !== false
  if (!shieldEnabled) restoreAdPlayback()
  publishState()
})

function clickIfVisible(el) {
  if (!el) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  try {
    el.click()
    return true
  } catch {
    return false
  }
}

function trySkip() {
  for (const sel of SELECTORS_SKIP) {
    const nodes = document.querySelectorAll(sel)
    for (const n of nodes) {
      if (clickIfVisible(n)) return true
    }
  }
  // Modern YouTube: skip via text
  const buttons = document.querySelectorAll('button, .ytp-button')
  for (const b of buttons) {
    const t = (b.textContent || '').trim().toLowerCase()
    if (
      t === 'skip' ||
      t === 'skip ad' ||
      t === 'skip ads' ||
      t.startsWith('skip ad')
    ) {
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
    if (video.dataset.yasSpeed) {
      try {
        video.playbackRate = Number(video.dataset.yasSpeed) || 1
        video.muted = video.dataset.yasMuted === '1'
      } catch {
        /* ignore */
      }
      delete video.dataset.yasSpeed
      delete video.dataset.yasMuted
    }
    return
  }

  // While ad: try skip, else jump toward end
  trySkip()
  try {
    if (!video.dataset.yasSpeed) {
      video.dataset.yasSpeed = String(video.playbackRate || 1)
      video.dataset.yasMuted = video.muted ? '1' : '0'
    }
    video.playbackRate = 16
    if (Number.isFinite(video.duration) && video.duration > 0) {
      // jump near end of ad
      if (video.currentTime < video.duration - 0.5) {
        video.currentTime = Math.max(0, video.duration - 0.3)
      }
    }
    video.muted = true
  } catch {
    /* ignore */
  }
}

function restoreAdPlayback() {
  const video = document.querySelector('video.html5-main-video, video')
  if (!video || !video.dataset.yasSpeed) return
  try {
    video.playbackRate = Number(video.dataset.yasSpeed) || 1
    video.muted = video.dataset.yasMuted === '1'
  } catch {
    /* ignore */
  }
  delete video.dataset.yasSpeed
  delete video.dataset.yasMuted
}

function tick() {
  if (!shieldEnabled) return
  trySkip()
  speedThroughAd()
  scheduleFeedAdContainerCleanup()
}

// Fast loop for skip button
setInterval(tick, 400)

// Mutation observer for ad DOM
const mo = new MutationObserver(() => tick())
const startObs = () => {
  if (!document.documentElement) return
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
  applyDesktopAppChrome()
  scheduleFeedAdContainerCleanup()
  registerDesktopAppWindow()
  ensureDesktopGuide()
}

if (document.documentElement) startObs()
else document.addEventListener('DOMContentLoaded', startObs)

// Also on SPA navigations
let lastHref = location.href
setInterval(() => {
  registerDesktopAppWindow()
  ensureDesktopGuide()
  if (location.href !== lastHref) {
    lastHref = location.href
    setTimeout(tick, 300)
  }
}, 800)
