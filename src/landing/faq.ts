/**
 * FAQ accordion data + pure view-state helpers for the AdVoid landing page.
 *
 * Kept free of React so the toggle/visual logic is unit-testable in isolation
 * (see tests/landing-faq.test.mjs). The original design allows multiple FAQ
 * items to be open at once, so open-state is modelled as a set of indices.
 */

export interface FaqItem {
  q: string
  a: string
}

export const FAQS: readonly FaqItem[] = [
  {
    q: 'Is AdVoid safe to use?',
    a: "Yes. AdVoid is open-source and only blocks ad-related network requests. It doesn't collect any data or track your browsing.",
  },
  {
    q: 'Will this break YouTube?',
    a: 'No. AdVoid only blocks ads. Videos, comments, likes, and all other YouTube features work normally.',
  },
  {
    q: 'How do I install the Android APK?',
    a: 'Download the APK, then enable "Install from Unknown Sources" in Settings → Security. Open the APK file to install.',
  },
  {
    q: 'macOS says the app is damaged. What do I do?',
    a: 'Right-click (or Control-click) the AdVoid app and select "Open". This bypasses Gatekeeper on first launch. The app is signed and safe.',
  },
] as const

/** Height the answer panel animates open to (matches the design's 0 → 240px). */
export const FAQ_OPEN_MAX_HEIGHT = '240px'

/**
 * Toggle the open/closed state of the FAQ at `index`, returning a new set.
 * Pure: never mutates the input set.
 */
export function toggleFaq(open: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(open)
  if (next.has(index)) {
    next.delete(index)
  } else {
    next.add(index)
  }
  return next
}

export interface FaqVisualState {
  /** `+` icon rotation — 45deg turns the plus into a × when open. */
  rotation: string
  /** Collapsible answer panel max-height. */
  maxHeight: string
}

/** Derive the animated visual state for a FAQ item from whether it is open. */
export function faqVisual(isOpen: boolean): FaqVisualState {
  return {
    rotation: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
    maxHeight: isOpen ? FAQ_OPEN_MAX_HEIGHT : '0px',
  }
}
