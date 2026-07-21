/** Client-side, best-effort OS detection used to highlight the visitor's likely download. */

export type DetectedPlatform = 'android' | 'macos' | 'windows' | 'ios' | 'unknown'

export interface NavigatorLike {
  userAgentData?: {
    platform?: string
    mobile?: boolean
  }
  userAgent?: string
  platform?: string
}

function fromUAPlatform(platform: string): DetectedPlatform | null {
  const p = platform.toLowerCase()
  if (p.includes('android')) return 'android'
  if (p.includes('ios') || p.includes('iphone') || p.includes('ipad')) return 'ios'
  if (p.includes('mac')) return 'macos'
  if (p.includes('win')) return 'windows'
  return null
}

/**
 * Categorizes the visitor's OS from `navigator.userAgentData` (preferred) or
 * `navigator.userAgent`/`navigator.platform` (fallback). Pure — pass a fake
 * navigator-shaped object in tests; falls back to the real `navigator` global
 * only when called with no argument at runtime.
 */
export function detectPlatform(nav?: NavigatorLike): DetectedPlatform {
  const source = nav ?? (typeof navigator !== 'undefined' ? (navigator as NavigatorLike) : {})

  const uaDataPlatform = source.userAgentData?.platform
  if (uaDataPlatform) {
    const detected = fromUAPlatform(uaDataPlatform)
    if (detected) return detected
  }

  const combined = `${source.userAgent ?? ''} ${source.platform ?? ''}`.toLowerCase()
  if (/android/.test(combined)) return 'android'
  if (/iphone|ipad|ipod/.test(combined)) return 'ios'
  if (/mac os x|macintosh/.test(combined)) return 'macos'
  if (/windows|win32|win64/.test(combined)) return 'windows'
  return 'unknown'
}
