/**
 * Shared, dependency-free model for the Tube desktop first-run guide.
 *
 * This file is loaded before content.js as a classic content script. Keeping
 * the step data and navigation rules here also lets Node exercise them without
 * requiring a browser DOM.
 */
(function registerTubeDesktopGuide(global) {
  const VERSION = 1

  const STEPS = Object.freeze([
    Object.freeze({
      eyebrow: 'Welcome to Tube',
      title: 'Use YouTube like you normally do',
      description:
        'Search, browse Home, open subscriptions, and play videos in this dedicated app window.',
      points: Object.freeze([
        'Your Google sign-in stays in this private Tube profile.',
        'YouTube navigation and keyboard shortcuts keep working.',
      ]),
      icon: 'play',
    }),
    Object.freeze({
      eyebrow: 'Automatic protection',
      title: 'YT Ads Shield is already running',
      description:
        'Tube starts its built-in Shield protection with the app and filters known YouTube ad requests automatically.',
      points: Object.freeze([
        'There is nothing to enable on each video.',
        'Keep Tube updated because YouTube changes its player regularly.',
      ]),
      icon: 'shield',
    }),
    Object.freeze({
      eyebrow: 'App navigation',
      title: 'Use the Tube Back button when you need it',
      description:
        'Tube hides the normal browser toolbar, so it adds its own Back control to the YouTube header.',
      points: Object.freeze([
        'Select the left arrow beside the YouTube menu.',
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
        'Tube keeps this walkthrough dismissed after you finish or skip it.',
      ]),
      icon: 'check',
    }),
  ])

  function clampStep(index) {
    const number = Number.isFinite(index) ? Math.trunc(index) : 0
    return Math.min(Math.max(number, 0), STEPS.length - 1)
  }

  function hasNextStep(index) {
    return clampStep(index) < STEPS.length - 1
  }

  function isFirstRun(completedVersion) {
    const version = Number(completedVersion)
    return !Number.isFinite(version) || version < VERSION
  }

  global.TubeDesktopGuide = Object.freeze({
    VERSION,
    STEPS,
    clampStep,
    hasNextStep,
    isFirstRun,
  })
})(globalThis)
