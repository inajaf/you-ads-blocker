/**
 * Shared, dependency-free model for the Noirva desktop first-run guide.
 *
 * This file is loaded before content.js as a classic content script. Keeping
 * the step data and navigation rules here also lets Node exercise them without
 * requiring a browser DOM.
 */
(function registerTubeDesktopGuide(global) {
  // Version 2 intentionally reopens onboarding for people who completed the
  // original Tube walkthrough before the Noirva rebrand.
  const VERSION = 2
  const PRODUCT_NAME = 'Noirva'
  const TAGLINE = 'Focused video with fewer interruptions.'

  const STEPS = Object.freeze([
    Object.freeze({
      eyebrow: `Welcome to ${PRODUCT_NAME}`,
      title: 'Use YouTube like you normally do',
      description:
        'Search, browse Home, open subscriptions, and play videos in this dedicated app window.',
      points: Object.freeze([
        `Your Google sign-in stays in this private ${PRODUCT_NAME} profile.`,
        'YouTube navigation and keyboard shortcuts keep working.',
      ]),
      icon: 'play',
    }),
    Object.freeze({
      eyebrow: 'Automatic protection',
      title: 'Noirva Shield is already running',
      description:
        `${PRODUCT_NAME} starts its built-in Shield protection with the app and filters known YouTube ad requests automatically.`,
      points: Object.freeze([
        'There is nothing to enable on each video.',
        `Keep ${PRODUCT_NAME} updated because YouTube changes its player regularly.`,
      ]),
      icon: 'shield',
    }),
    Object.freeze({
      eyebrow: 'App navigation',
      title: `Use the ${PRODUCT_NAME} Back button when you need it`,
      description:
        `${PRODUCT_NAME} hides the normal browser toolbar, so it adds its own Back control to the YouTube header.`,
      points: Object.freeze([
        'Select the left arrow at the start of the YouTube header.',
        'Keyboard alternatives: Command + [ on Mac or Alt + Left on Windows.',
      ]),
      icon: 'back',
    }),
    Object.freeze({
      eyebrow: 'Ready to watch',
      title: 'Your setup is saved for next time',
      description:
        'Close the window normally when you finish. The dedicated profile remembers your sign-in for the next launch.',
      points: Object.freeze([
        'Use the question-mark button in the header to reopen this guide.',
        `${PRODUCT_NAME} keeps this walkthrough dismissed after you finish or skip it.`,
      ]),
      icon: 'check',
    }),
  ])

  const ELECTRON_STEPS = Object.freeze(
    STEPS.map((step, index) => {
      if (index !== 0) return step
      return Object.freeze({
        ...step,
        description:
          `Browse as a guest here. When you choose Sign in, ${PRODUCT_NAME} switches to a supported Chrome app window.`,
        points: Object.freeze([
          `Google blocks account sign-in inside Electron, so ${PRODUCT_NAME} never asks you to bypass that warning.`,
          `The private ${PRODUCT_NAME} Chrome profile remembers your Google session.`,
        ]),
      })
    }),
  )

  function createGuide(steps) {
    function clampStep(index) {
      const number = Number.isFinite(index) ? Math.trunc(index) : 0
      return Math.min(Math.max(number, 0), steps.length - 1)
    }

    function hasNextStep(index) {
      return clampStep(index) < steps.length - 1
    }

    function isFirstRun(completedVersion) {
      const version = Number(completedVersion)
      return !Number.isFinite(version) || version < VERSION
    }

    return Object.freeze({
      VERSION,
      PRODUCT_NAME,
      TAGLINE,
      STEPS: steps,
      clampStep,
      hasNextStep,
      isFirstRun,
    })
  }

  const chromeGuide = createGuide(STEPS)
  const electronGuide = createGuide(ELECTRON_STEPS)

  global.TubeDesktopGuide = Object.freeze({
    ...chromeGuide,
    forEnvironment(environment) {
      return environment === 'electron' ? electronGuide : chromeGuide
    },
  })
})(globalThis)
