/**
 * Shared DOM UI for the Noirva first-run guide.
 *
 * Chrome App Mode and Electron provide different persistence adapters, while
 * this module owns the common dialog and YouTube header controls.
 */
(function registerTubeDesktopGuideUI(global) {
  const DESKTOP_BACK_ID = 'tube-desktop-back'
  const DESKTOP_HELP_ID = 'tube-desktop-help'
  const DESKTOP_GUIDE_ID = 'tube-desktop-guide'
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

  let installedController = null

  function createWebStorageAdapter(webStorage, key) {
    if (!webStorage || typeof webStorage.getItem !== 'function') {
      throw new TypeError('A Web Storage-compatible object is required')
    }
    if (!key) throw new TypeError('A storage key is required')

    return Object.freeze({
      async getCompletedVersion() {
        const value = webStorage.getItem(key)
        return value === null ? 0 : Number(value)
      },
      async setCompletedVersion(version) {
        webStorage.setItem(key, String(version))
      },
    })
  }

  function createElement(tagName, { className, id, text, attributes = {} } = {}) {
    const element = document.createElement(tagName)
    if (className) element.className = className
    if (id) element.id = id
    if (text) element.textContent = text
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, String(value))
    }
    return element
  }

  function createSvgIcon(paths, circles = []) {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')

    for (const attributes of circles) {
      const circle = document.createElementNS(SVG_NAMESPACE, 'circle')
      for (const [name, value] of Object.entries(attributes)) {
        circle.setAttribute(name, value)
      }
      svg.append(circle)
    }
    for (const d of paths) {
      const path = document.createElementNS(SVG_NAMESPACE, 'path')
      path.setAttribute('d', d)
      svg.append(path)
    }
    return svg
  }

  function createStepIcon(name) {
    const paths = {
      play: ['m9 18 6-6-6-6v12Z'],
      shield: [
        'M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z',
        'm9.4 12 1.7 1.7 3.8-4',
      ],
      back: ['m15 18-6-6 6-6'],
      check: ['m5 12 4 4L19 6'],
    }
    return createSvgIcon(paths[name] || paths.play)
  }

  function createBackButton() {
    const button = document.createElement('button')
    button.id = DESKTOP_BACK_ID
    button.type = 'button'
    button.setAttribute('aria-label', 'Go back')
    button.title = 'Back (⌘[ or Alt+Left)'
    button.append(createSvgIcon(['M15 18l-6-6 6-6']))
    button.addEventListener('click', () => {
      const isAppEntry = new URLSearchParams(location.search).get('tube_app') === '1'
      if (isAppEntry) location.assign('https://www.youtube.com/?tube_app=1')
      else if (history.length > 1) history.back()
      else location.assign('https://www.youtube.com/')
    })
    return button
  }

  function createController(guide, storage, logoUrl) {
    let guideCheckStarted = false

    function markComplete() {
      Promise.resolve(storage.setCompletedVersion(guide.VERSION)).catch((error) => {
        console.error('[Noirva] failed to save first-run guide state:', error)
      })
    }

    function openGuide() {
      if (window.top !== window || !document.body) return

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

      const shell = createElement('div', { className: 'tube-guide-shell' })
      const closeButton = createElement('button', {
        className: 'tube-guide-close',
        attributes: { type: 'button', 'aria-label': 'Close getting started guide' },
      })
      closeButton.append(createSvgIcon(['m6 6 12 12M18 6 6 18']))

      const visual = createElement('aside', {
        className: 'tube-guide-visual',
        attributes: { 'aria-hidden': 'true' },
      })
      const brand = createElement('div', { className: 'tube-guide-brand' })
      const brandMark = createElement('span', { className: 'tube-guide-brand-mark' })
      if (logoUrl) {
        brandMark.append(
          createElement('img', {
            attributes: {
              src: logoUrl,
              alt: '',
              width: 40,
              height: 40,
            },
          }),
        )
      } else {
        brandMark.append(createStepIcon('play'))
      }
      brand.append(
        brandMark,
        createElement('span', { text: guide.PRODUCT_NAME || 'Noirva' }),
      )
      const heroIcon = createElement('div', { className: 'tube-guide-hero-icon' })
      const visualCopy = createElement('p', {
        className: 'tube-guide-visual-copy',
        text: guide.TAGLINE || 'Focused video with fewer interruptions.',
      })
      visual.append(brand, heroIcon, visualCopy)

      const content = createElement('section', { className: 'tube-guide-content' })
      const progress = createElement('div', {
        className: 'tube-guide-progress',
        attributes: {
          role: 'progressbar',
          'aria-label': 'Guide progress',
          'aria-valuemin': 1,
          'aria-valuemax': guide.STEPS.length,
        },
      })
      const progressSegments = guide.STEPS.map((_, index) =>
        createElement('span', {
          className: 'tube-guide-progress-segment',
          attributes: { 'data-progress': index },
        }),
      )
      progress.append(...progressSegments)
      const stepCount = createElement('p', { className: 'tube-guide-step-count' })
      const eyebrow = createElement('p', { className: 'tube-guide-eyebrow' })
      const heading = createElement('h2', {
        className: 'tube-guide-title',
        id: 'tube-guide-title',
        attributes: { tabindex: -1 },
      })
      const description = createElement('p', {
        className: 'tube-guide-description',
        id: 'tube-guide-description',
      })
      const points = createElement('ul', { className: 'tube-guide-points' })
      const actions = createElement('footer', { className: 'tube-guide-actions' })
      const skipButton = createElement('button', {
        className: 'tube-guide-skip',
        text: 'Skip guide',
        attributes: { type: 'button' },
      })
      const stepActions = createElement('div', { className: 'tube-guide-step-actions' })
      const backButton = createElement('button', {
        className: 'tube-guide-back',
        text: 'Back',
        attributes: { type: 'button' },
      })
      const nextButton = createElement('button', {
        className: 'tube-guide-next',
        text: 'Next',
        attributes: { type: 'button' },
      })
      stepActions.append(backButton, nextButton)
      actions.append(skipButton, stepActions)
      content.append(progress, stepCount, eyebrow, heading, description, points, actions)
      shell.append(closeButton, visual, content)
      dialog.append(shell)

      let stepIndex = 0

      function renderStep({ moveFocus = true } = {}) {
        stepIndex = guide.clampStep(stepIndex)
        const step = guide.STEPS[stepIndex]
        progress.setAttribute('aria-valuenow', String(stepIndex + 1))
        progress.setAttribute(
          'aria-valuetext',
          `Step ${stepIndex + 1} of ${guide.STEPS.length}`,
        )
        progressSegments.forEach((segment, index) => {
          segment.classList.toggle('is-complete', index <= stepIndex)
        })
        stepCount.textContent = `Step ${stepIndex + 1} of ${guide.STEPS.length}`
        eyebrow.textContent = step.eyebrow
        heading.textContent = step.title
        description.textContent = step.description
        heroIcon.replaceChildren(createStepIcon(step.icon))
        points.replaceChildren(
          ...step.points.map((point) => {
            const item = document.createElement('li')
            item.textContent = point
            return item
          }),
        )
        backButton.hidden = stepIndex === 0
        nextButton.textContent = guide.hasNextStep(stepIndex) ? 'Next' : 'Start watching'
        if (moveFocus) requestAnimationFrame(() => heading.focus())
      }

      function closeGuide() {
        markComplete()
        dialog.close()
        dialog.remove()
      }

      closeButton.addEventListener('click', closeGuide)
      skipButton.addEventListener('click', closeGuide)
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        closeGuide()
      })
      backButton.addEventListener('click', () => {
        stepIndex -= 1
        renderStep()
      })
      nextButton.addEventListener('click', () => {
        if (!guide.hasNextStep(stepIndex)) {
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
      button.setAttribute('aria-label', 'Open Noirva getting started guide')
      button.title = 'Getting started'
      button.append(
        createSvgIcon(
          ['M9.8 9a2.4 2.4 0 0 1 4.7.7c0 1.8-2.5 2-2.5 3.8', 'M12 17h.01'],
          [{ cx: '12', cy: '12', r: '9' }],
        ),
      )
      button.addEventListener('click', openGuide)
      return button
    }

    async function maybeShowFirstRunGuide() {
      if (guideCheckStarted || window.top !== window || !document.body) return
      guideCheckStarted = true

      try {
        const completedVersion = await storage.getCompletedVersion()
        if (guide.isFirstRun(completedVersion)) openGuide()
      } catch (error) {
        console.error('[Noirva] failed to read first-run guide state:', error)
        openGuide()
      }
    }

    function ensureNavigation() {
      if (window.top !== window || !document.body) return
      void maybeShowFirstRunGuide()

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
    }

    return Object.freeze({ ensureNavigation, openGuide })
  }

  function install({ guide = global.TubeDesktopGuide, storage, logoUrl } = {}) {
    if (installedController) return installedController
    if (!guide || !Array.isArray(guide.STEPS)) {
      throw new TypeError('TubeDesktopGuide model is required')
    }
    if (
      !storage ||
      typeof storage.getCompletedVersion !== 'function' ||
      typeof storage.setCompletedVersion !== 'function'
    ) {
      throw new TypeError('A desktop guide storage adapter is required')
    }

    installedController = createController(guide, storage, logoUrl)
    const ensureNavigation = () => installedController.ensureNavigation()
    if (document.body) ensureNavigation()
    else document.addEventListener('DOMContentLoaded', ensureNavigation, { once: true })
    setInterval(ensureNavigation, 800)
    return installedController
  }

  global.TubeDesktopGuideUI = Object.freeze({
    createWebStorageAdapter,
    install,
  })
})(globalThis)
