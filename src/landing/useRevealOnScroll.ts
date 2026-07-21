import { useEffect, type RefObject } from 'react'

/**
 * Reveal-on-scroll for the landing page. Every `[data-reveal]` descendant of
 * `rootRef` starts hidden (see landing.css) and fades/slides in when it scrolls
 * into view. The IntersectionObserver is disconnected in cleanup (project rule:
 * clean up side effects). Respects `prefers-reduced-motion` by revealing every
 * element immediately with no observer and no motion.
 */
export function useRevealOnScroll(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const elements = Array.from(
      root.querySelectorAll<HTMLElement>('[data-reveal]'),
    )

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      // No animation: show everything up front.
      for (const el of elements) el.classList.add('is-revealed')
      return
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            obs.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    for (const el of elements) observer.observe(el)

    return () => observer.disconnect()
  }, [rootRef])
}
