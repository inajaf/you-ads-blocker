/** Static content for the Noirva landing page, ported from the design source. */

// Download URLs live in ./platforms.ts (PLATFORMS) — see there for why they
// use the "latest release" URL convention.

export interface Layer {
  num: number
  icon: string
  title: string
  body: string
}

export const LAYERS: readonly Layer[] = [
  {
    num: 1,
    icon: '🛡️',
    title: 'Network Rules',
    body: 'Blocks ad requests before they even load. A curated rule list stops tracking scripts, analytics, and ad networks at the network level.',
  },
  {
    num: 2,
    icon: '⚡',
    title: 'API Filtering',
    body: "Intercepts YouTube's API responses and strips out ad placements, sponsored content, and promotional data before it reaches your screen.",
  },
  {
    num: 3,
    icon: '🧹',
    title: 'DOM Cleanup',
    body: 'Removes any remaining ad elements from the page. Even if something slips through, the DOM layer clears the visual clutter.',
  },
] as const

export interface Step {
  num: number
  title: string
  body: string
}

export const STEPS: readonly Step[] = [
  {
    num: 1,
    title: 'Network interception',
    body: "When you load YouTube, Noirva's network rules immediately block connections to ad servers, tracking pixels, and analytics endpoints.",
  },
  {
    num: 2,
    title: 'Response filtering',
    body: "As YouTube's API responses arrive, Noirva parses them in real time and removes ad placements, sponsored cards, and promotional content.",
  },
  {
    num: 3,
    title: 'DOM cleanup',
    body: 'Finally, Noirva scans the rendered page and removes any remaining ad elements, placeholders, or banners that made it through.',
  },
] as const

export const MARQUEE_ITEMS: readonly string[] = [
  'NO PRE-ROLL ADS',
  'NO MID-ROLL ADS',
  'NO SPONSORED CARDS',
  'NO TRACKING',
  'NO ANALYTICS',
  'PRIVATE BY DESIGN',
  'OPEN SOURCE',
  'MIT LICENSED',
] as const
