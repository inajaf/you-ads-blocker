/**
 * Shared DOM UI for the Noirva first-run guide.
 *
 * Chrome App Mode and Electron provide different persistence adapters, while
 * this module owns the common dialog and YouTube header controls.
 */
(function registerTubeDesktopGuideUI(global) {
  const DESKTOP_BACK_ID = 'tube-desktop-back'
  const DESKTOP_HELP_ID = 'tube-desktop-help'
  const DESKTOP_MAINTENANCE_ID = 'tube-desktop-maintenance'
  const DESKTOP_GUIDE_ID = 'tube-desktop-guide'
  const DESKTOP_MAINTENANCE_DIALOG_ID = 'tube-desktop-maintenance-dialog'
  const DESKTOP_TOAST_ID = 'tube-desktop-toast'
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
      history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 2'],
      cache: [
        'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z',
        'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
        'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
      ],
    }
    return createSvgIcon(paths[name] || paths.play)
  }

  function getMaintenanceCopy() {
    return {
      buttonLabel: 'Clean up Noirva data',
      dialogTitle: 'Clean up Noirva data',
      dialogDescription:
        'Remove history or temporary files from this private app profile. YouTube sign-in and cookies are preserved.',
      closeLabel: 'Close data cleanup',
      historyTitle: 'Browser history',
      historyDescription: 'Removes the list of pages visited in the Noirva profile.',
      historyAction: 'Clear history',
      cacheTitle: 'Browser cache',
      cacheDescription: 'Removes temporary files. Needed content will download again.',
      cacheAction: 'Clear cache',
      cancel: 'Cancel',
      confirm: 'Clear',
      clearing: 'Clearing…',
      confirmTitle: (label) => `${label}?`,
      confirmDescription:
        'This cannot be undone. Cookies, passwords and your YouTube sign-in will not be touched.',
      success: {
        history: 'History cleared. Your YouTube sign-in was preserved.',
        cache: 'Cache cleared. Your YouTube sign-in was preserved.',
      },
      error: 'Noirva could not clear the data. Please try again.',
    }
  }

  // The back button is only ever injected while Noirva runs in desktop app
  // mode, so every fallback must return to the app's YouTube home with its
  // tube_app context intact. Studio and the upload popup open as fresh surfaces
  // where history.length === 1; the old plain-youtube.com fallback dropped app
  // mode there, so the arrow appeared to do nothing useful.
  function resolveBackNavigation({ search, historyLength }) {
    const isAppEntry = new URLSearchParams(search).get('tube_app') === '1'
    if (!isAppEntry && historyLength > 1) return { type: 'back' }
    return { type: 'assign', url: 'https://www.youtube.com/?tube_app=1' }
  }

  function createBackButton() {
    const button = document.createElement('button')
    button.id = DESKTOP_BACK_ID
    button.type = 'button'
    button.setAttribute('aria-label', 'Go back')
    button.title = 'Back (⌘[ or Alt+Left)'
    button.append(createSvgIcon(['M15 18l-6-6 6-6']))
    button.addEventListener('click', () => {
      const decision = resolveBackNavigation({
        search: location.search,
        historyLength: history.length,
      })
      if (decision.type === 'back') history.back()
      else location.assign(decision.url)
    })
    return button
  }

  function createController(guide, storage, logoUrl, maintenance) {
    let guideCheckStarted = false

    function showToast(message) {
      document.getElementById(DESKTOP_TOAST_ID)?.remove()
      const toast = createElement('div', {
        className: 'tube-desktop-toast',
        id: DESKTOP_TOAST_ID,
        text: message,
        attributes: { role: 'status', 'aria-live': 'polite' },
      })
      document.body.append(toast)
      setTimeout(() => toast.remove(), 4_000)
    }

    function openMaintenance() {
      if (!maintenance || window.top !== window || !document.body) return

      const existing = document.getElementById(DESKTOP_MAINTENANCE_DIALOG_ID)
      if (existing) {
        if (!existing.open) existing.showModal()
        existing.querySelector('.tube-maintenance-title')?.focus()
        return
      }

      const copy = getMaintenanceCopy()
      const dialog = document.createElement('dialog')
      dialog.id = DESKTOP_MAINTENANCE_DIALOG_ID
      dialog.setAttribute('aria-labelledby', 'tube-maintenance-title')
      dialog.setAttribute('aria-describedby', 'tube-maintenance-description')

      const shell = createElement('section', { className: 'tube-maintenance-shell' })
      const heading = createElement('h2', {
        className: 'tube-maintenance-title',
        id: 'tube-maintenance-title',
        text: copy.dialogTitle,
        attributes: { tabindex: -1 },
      })
      const description = createElement('p', {
        className: 'tube-maintenance-description',
        id: 'tube-maintenance-description',
        text: copy.dialogDescription,
      })
      const closeButton = createElement('button', {
        className: 'tube-maintenance-close',
        attributes: { type: 'button', 'aria-label': copy.closeLabel },
      })
      closeButton.append(createSvgIcon(['m6 6 12 12M18 6 6 18']))

      const actionGrid = createElement('div', { className: 'tube-maintenance-grid' })
      const confirmPanel = createElement('section', {
        className: 'tube-maintenance-confirm',
        attributes: { hidden: true },
      })
      const confirmHeading = createElement('h3', {
        className: 'tube-maintenance-confirm-title',
        attributes: { tabindex: -1 },
      })
      const confirmDescription = createElement('p', {
        className: 'tube-maintenance-confirm-description',
        text: copy.confirmDescription,
      })
      const errorMessage = createElement('p', {
        className: 'tube-maintenance-error',
        attributes: { role: 'alert', hidden: true },
      })
      const confirmActions = createElement('div', { className: 'tube-maintenance-confirm-actions' })
      const cancelButton = createElement('button', {
        className: 'tube-maintenance-cancel',
        text: copy.cancel,
        attributes: { type: 'button' },
      })
      const confirmButton = createElement('button', {
        className: 'tube-maintenance-confirm-button',
        text: copy.confirm,
        attributes: { type: 'button' },
      })
      confirmActions.append(cancelButton, confirmButton)
      confirmPanel.append(confirmHeading, confirmDescription, errorMessage, confirmActions)

      let pendingAction = null

      function showConfirmation(action, label) {
        pendingAction = action
        confirmHeading.textContent = copy.confirmTitle(label)
        errorMessage.hidden = true
        actionGrid.hidden = true
        confirmPanel.hidden = false
        requestAnimationFrame(() => confirmHeading.focus?.())
      }

      function createMaintenanceCard({ action, title, description: cardDescription, label, icon }) {
        const card = createElement('article', { className: 'tube-maintenance-card' })
        const iconShell = createElement('span', {
          className: 'tube-maintenance-card-icon',
          attributes: { 'aria-hidden': 'true' },
        })
        iconShell.append(createStepIcon(icon))
        const copyShell = createElement('div', { className: 'tube-maintenance-card-copy' })
        copyShell.append(
          createElement('h3', { text: title }),
          createElement('p', { text: cardDescription }),
        )
        const button = createElement('button', {
          className: 'tube-maintenance-action',
          text: label,
          attributes: { type: 'button' },
        })
        button.addEventListener('click', () => showConfirmation(action, label))
        card.append(iconShell, copyShell, button)
        return card
      }

      actionGrid.append(
        createMaintenanceCard({
          action: 'history',
          title: copy.historyTitle,
          description: copy.historyDescription,
          label: copy.historyAction,
          icon: 'history',
        }),
        createMaintenanceCard({
          action: 'cache',
          title: copy.cacheTitle,
          description: copy.cacheDescription,
          label: copy.cacheAction,
          icon: 'cache',
        }),
      )

      function closeDialog() {
        dialog.close()
        dialog.remove()
      }

      closeButton.addEventListener('click', closeDialog)
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        closeDialog()
      })
      cancelButton.addEventListener('click', () => {
        pendingAction = null
        confirmPanel.hidden = true
        actionGrid.hidden = false
        actionGrid.querySelector('button')?.focus()
      })
      confirmButton.addEventListener('click', async () => {
        if (!pendingAction) return
        const action = pendingAction
        confirmButton.disabled = true
        cancelButton.disabled = true
        confirmButton.textContent = copy.clearing
        errorMessage.hidden = true

        try {
          await maintenance.clear(action)
          closeDialog()
          showToast(copy.success[action])
        } catch (error) {
          console.error('[Noirva] failed to clear browsing data:', error)
          errorMessage.textContent = copy.error
          errorMessage.hidden = false
        } finally {
          confirmButton.disabled = false
          cancelButton.disabled = false
          confirmButton.textContent = copy.confirm
        }
      })

      shell.append(closeButton, heading, description, actionGrid, confirmPanel)
      dialog.append(shell)
      document.body.append(dialog)
      dialog.showModal()
      requestAnimationFrame(() => heading.focus())
    }

    function createMaintenanceButton() {
      const button = document.createElement('button')
      button.id = DESKTOP_MAINTENANCE_ID
      button.type = 'button'
      const copy = getMaintenanceCopy()
      button.setAttribute('aria-label', copy.buttonLabel)
      button.title = copy.buttonLabel
      button.append(
        createSvgIcon([
          'M4 7h10',
          'M4 12h16',
          'M10 17h10',
          'M17 4v6',
          'M7 14v6',
        ]),
      )
      button.addEventListener('click', openMaintenance)
      return button
    }

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
      const isStudio = location.hostname === 'studio.youtube.com'
      let navigationHost = mastheadStart
      if (!navigationHost && isStudio) {
        navigationHost = document.getElementById('tube-desktop-studio-navigation')
        if (!navigationHost) {
          navigationHost = createElement('nav', {
            id: 'tube-desktop-studio-navigation',
          })
          navigationHost.setAttribute('aria-label', 'Noirva navigation')
          document.body.append(navigationHost)
        }
      }

      // Fallback: on pages without a masthead (Account, Your data on YouTube,
      // etc.), create a fixed-position navigation bar so the back button is
      // always available.
      if (!navigationHost) {
        navigationHost = document.getElementById('tube-desktop-studio-navigation')
        if (!navigationHost) {
          navigationHost = createElement('nav', {
            id: 'tube-desktop-studio-navigation',
          })
          navigationHost.setAttribute('aria-label', 'Noirva navigation')
          document.body.append(navigationHost)
        }
      }

      const guideButton = mastheadStart?.querySelector('#guide-button')
      let backButton = document.getElementById(DESKTOP_BACK_ID)
      if (!backButton) {
        backButton = createBackButton()
        if (guideButton) guideButton.insertAdjacentElement('afterend', backButton)
        else navigationHost.prepend(backButton)
      }

      if (isStudio) return

      let helpButton = document.getElementById(DESKTOP_HELP_ID)
      if (!helpButton) {
        helpButton = createHelpButton()
        backButton.insertAdjacentElement('afterend', helpButton)
      }

      if (maintenance && !document.getElementById(DESKTOP_MAINTENANCE_ID)) {
        helpButton.insertAdjacentElement('afterend', createMaintenanceButton())
      }
    }

    return Object.freeze({ ensureNavigation, openGuide })
  }

  function install({ guide = global.TubeDesktopGuide, storage, logoUrl, maintenance } = {}) {
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
    if (maintenance && typeof maintenance.clear !== 'function') {
      throw new TypeError('A Noirva maintenance adapter must provide clear(action)')
    }

    installedController = createController(guide, storage, logoUrl, maintenance)
    const ensureNavigation = () => installedController.ensureNavigation()
    if (document.body) ensureNavigation()
    else document.addEventListener('DOMContentLoaded', ensureNavigation, { once: true })
    setInterval(ensureNavigation, 800)
    return installedController
  }

  global.TubeDesktopGuideUI = Object.freeze({
    createWebStorageAdapter,
    install,
    resolveBackNavigation,
  })
})(globalThis)
