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

const STATE_EVENT = 'yt-ads-shield:state'
let shieldEnabled = false

const DESKTOP_APP_KEY = 'tube.desktopAppMode'
const DESKTOP_BACK_ID = 'tube-desktop-back'
const DESKTOP_HELP_ID = 'tube-desktop-help'
const DESKTOP_GUIDE_ID = 'tube-desktop-guide'
const DESKTOP_GUIDE_STORAGE_KEY = 'tube.desktopGuideVersion'
const desktopGuide = globalThis.TubeDesktopGuide
let desktopGuideCheckStarted = false

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

function createBackButton() {
  const button = document.createElement('button')
  button.id = DESKTOP_BACK_ID
  button.type = 'button'
  button.setAttribute('aria-label', 'Go back')
  button.title = 'Back (⌘[ or Alt+Left)'
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  `
  button.addEventListener('click', () => {
    if (history.length > 1) history.back()
    else location.assign('https://www.youtube.com/')
  })
  return button
}

function iconMarkup(name) {
  const paths = {
    play: '<path d="m9 18 6-6-6-6v12Z" />',
    shield:
      '<path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9.4 12 1.7 1.7 3.8-4" />',
    back: '<path d="m15 18-6-6 6-6" />',
    check: '<path d="m5 12 4 4L19 6" />',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${
    paths[name] || paths.play
  }</svg>`
}

function markDesktopGuideComplete() {
  if (!desktopGuide) return
  chrome.storage.local.set({
    [DESKTOP_GUIDE_STORAGE_KEY]: desktopGuide.VERSION,
  })
}

function openDesktopGuide() {
  if (!desktopGuide || window.top !== window || !document.body) return

  const existing = document.getElementById(DESKTOP_GUIDE_ID)
  if (existing) {
    if (!existing.open) existing.showModal()
    existing.querySelector('.tube-guide-title')?.focus()
    return
  }

  const dialog = document.createElement('dialog')
  dialog.id = DESKTOP_GUIDE_ID
  dialog.setAttribute('aria-labelledby', 'tube-guide-title')
  dialog.setAttribute('aria-describedby', 'tube-guide-description')
  dialog.innerHTML = `
    <div class="tube-guide-shell">
      <button class="tube-guide-close" type="button" aria-label="Close getting started guide">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <aside class="tube-guide-visual" aria-hidden="true">
        <div class="tube-guide-brand">
          <span class="tube-guide-brand-mark">${iconMarkup('play')}</span>
          <span>Tube</span>
        </div>
        <div class="tube-guide-hero-icon"></div>
        <p class="tube-guide-visual-copy">A focused YouTube window with YT Ads Shield built in.</p>
      </aside>
      <section class="tube-guide-content">
        <div class="tube-guide-progress" role="progressbar" aria-label="Guide progress" aria-valuemin="1" aria-valuemax="${desktopGuide.STEPS.length}">
          ${desktopGuide.STEPS.map(
            (_, index) => `<span class="tube-guide-progress-segment" data-progress="${index}"></span>`,
          ).join('')}
        </div>
        <p class="tube-guide-step-count"></p>
        <p class="tube-guide-eyebrow"></p>
        <h2 class="tube-guide-title" id="tube-guide-title" tabindex="-1"></h2>
        <p class="tube-guide-description" id="tube-guide-description"></p>
        <ul class="tube-guide-points"></ul>
        <footer class="tube-guide-actions">
          <button class="tube-guide-skip" type="button">Skip guide</button>
          <div class="tube-guide-step-actions">
            <button class="tube-guide-back" type="button">Back</button>
            <button class="tube-guide-next" type="button">Next</button>
          </div>
        </footer>
      </section>
    </div>
  `

  let stepIndex = 0
  const heading = dialog.querySelector('.tube-guide-title')
  const progress = dialog.querySelector('.tube-guide-progress')
  const stepCount = dialog.querySelector('.tube-guide-step-count')
  const eyebrow = dialog.querySelector('.tube-guide-eyebrow')
  const description = dialog.querySelector('.tube-guide-description')
  const points = dialog.querySelector('.tube-guide-points')
  const heroIcon = dialog.querySelector('.tube-guide-hero-icon')
  const backButton = dialog.querySelector('.tube-guide-back')
  const nextButton = dialog.querySelector('.tube-guide-next')

  function renderStep({ moveFocus = true } = {}) {
    stepIndex = desktopGuide.clampStep(stepIndex)
    const step = desktopGuide.STEPS[stepIndex]
    progress.setAttribute('aria-valuenow', String(stepIndex + 1))
    progress.setAttribute(
      'aria-valuetext',
      `Step ${stepIndex + 1} of ${desktopGuide.STEPS.length}`,
    )
    dialog.querySelectorAll('[data-progress]').forEach((segment, index) => {
      segment.classList.toggle('is-complete', index <= stepIndex)
    })
    stepCount.textContent = `Step ${stepIndex + 1} of ${desktopGuide.STEPS.length}`
    eyebrow.textContent = step.eyebrow
    heading.textContent = step.title
    description.textContent = step.description
    heroIcon.innerHTML = iconMarkup(step.icon)
    points.replaceChildren(
      ...step.points.map((point) => {
        const item = document.createElement('li')
        item.textContent = point
        return item
      }),
    )
    backButton.hidden = stepIndex === 0
    nextButton.textContent = desktopGuide.hasNextStep(stepIndex) ? 'Next' : 'Start watching'
    if (moveFocus) requestAnimationFrame(() => heading.focus())
  }

  function closeGuide() {
    markDesktopGuideComplete()
    dialog.close()
    dialog.remove()
  }

  dialog.querySelector('.tube-guide-close').addEventListener('click', closeGuide)
  dialog.querySelector('.tube-guide-skip').addEventListener('click', closeGuide)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    closeGuide()
  })
  backButton.addEventListener('click', () => {
    stepIndex -= 1
    renderStep()
  })
  nextButton.addEventListener('click', () => {
    if (!desktopGuide.hasNextStep(stepIndex)) {
      closeGuide()
      return
    }
    stepIndex += 1
    renderStep()
  })

  document.body.append(dialog)
  renderStep({ moveFocus: false })
  dialog.showModal()
  requestAnimationFrame(() => heading.focus())
}

function createHelpButton() {
  const button = document.createElement('button')
  button.id = DESKTOP_HELP_ID
  button.type = 'button'
  button.setAttribute('aria-label', 'Open Tube getting started guide')
  button.title = 'Getting started'
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 0 1 4.7.7c0 1.8-2.5 2-2.5 3.8" />
      <path d="M12 17h.01" />
    </svg>
  `
  button.addEventListener('click', openDesktopGuide)
  return button
}

function maybeShowFirstRunGuide() {
  if (
    desktopGuideCheckStarted ||
    !desktopGuide ||
    window.top !== window ||
    !isDesktopAppMode()
  ) {
    return
  }
  desktopGuideCheckStarted = true
  chrome.storage.local.get({ [DESKTOP_GUIDE_STORAGE_KEY]: 0 }, (cfg) => {
    if (desktopGuide.isFirstRun(cfg[DESKTOP_GUIDE_STORAGE_KEY])) {
      openDesktopGuide()
    }
  })
}

function ensureDesktopNavigation() {
  if (!isDesktopAppMode() || window.top !== window) return

  const mastheadStart = document.querySelector('ytd-masthead #start')
  if (!mastheadStart) return

  const guideButton = mastheadStart.querySelector('#guide-button')
  let backButton = document.getElementById(DESKTOP_BACK_ID)
  if (!backButton) {
    backButton = createBackButton()
    if (guideButton) guideButton.insertAdjacentElement('afterend', backButton)
    else mastheadStart.prepend(backButton)
  }

  if (!document.getElementById(DESKTOP_HELP_ID)) {
    backButton.insertAdjacentElement('afterend', createHelpButton())
  }

  maybeShowFirstRunGuide()
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
  ensureDesktopNavigation()
}

if (document.documentElement) startObs()
else document.addEventListener('DOMContentLoaded', startObs)

// Also on SPA navigations
let lastHref = location.href
setInterval(() => {
  ensureDesktopNavigation()
  if (location.href !== lastHref) {
    lastHref = location.href
    setTimeout(tick, 300)
  }
}, 800)
