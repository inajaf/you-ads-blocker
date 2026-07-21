/**
 * Single source of truth for every platform the landing page offers.
 * Both the hero CTA row and the #download cards render from PLATFORMS —
 * adding a platform (e.g. Windows, once its release exists) means adding
 * one entry here, not copy-pasting JSX.
 *
 * Download hrefs use GitHub's "latest release" convention so a version bump
 * alone never breaks the link — see docs/decisions.md for the constraint
 * this places on future release asset filenames.
 */
import type { DetectedPlatform } from './detectPlatform'

const RELEASES_LATEST = 'https://github.com/inajaf/you-ads-blocker/releases/latest/download'

export type PlatformId = 'android' | 'macos' | 'ios'
export type PlatformIcon = 'android' | 'apple'

interface PlatformCommon {
  id: PlatformId
  name: string
  icon: PlatformIcon
  /** Meta line shown on the download card, e.g. "APK · 10MB · Android 8.0+". */
  spec: string
}

export interface DownloadPlatform extends PlatformCommon {
  kind: 'download'
  href: string
  /** Hero button text, e.g. "Download for Android". */
  ctaLabel: string
  /** Download-section button text, e.g. "Download APK". */
  downloadLabel: string
  /** Default (undetected-visitor) highlight style for this entry. */
  primary: boolean
  note?: string
}

export interface SourcePlatform extends PlatformCommon {
  kind: 'source'
  bodyPrefix: string
  codePath: string
  bodySuffix: string
}

export type Platform = DownloadPlatform | SourcePlatform

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'android',
    kind: 'download',
    name: 'Android',
    icon: 'android',
    spec: 'APK · 10MB · Android 8.0+',
    href: `${RELEASES_LATEST}/app-release.apk`,
    ctaLabel: 'Download for Android',
    downloadLabel: 'Download APK',
    primary: true,
  },
  {
    id: 'macos',
    kind: 'download',
    name: 'macOS',
    icon: 'apple',
    spec: 'DMG · 119MB · macOS 12+',
    href: `${RELEASES_LATEST}/Noirva-1.0.0-arm64.dmg`,
    ctaLabel: 'Download for macOS',
    downloadLabel: 'Download DMG',
    primary: false,
    note: 'Right-click → Open on first launch',
  },
  {
    id: 'ios',
    kind: 'source',
    name: 'iOS',
    icon: 'apple',
    spec: 'Source · Xcode build',
    bodyPrefix: 'Clone the repo, open ',
    codePath: 'ios/Noirva.xcodeproj',
    bodySuffix: ' in Xcode, and build to your device. Apple Developer account required.',
  },
] as const

export function isDownloadPlatform(platform: Platform): platform is DownloadPlatform {
  return platform.kind === 'download'
}

export const DOWNLOAD_PLATFORMS: readonly DownloadPlatform[] = PLATFORMS.filter(isDownloadPlatform)

/**
 * Reorders download platforms so the visitor's detected OS renders first
 * (and thus gets the primary/highlighted style). Falls back to the
 * unmodified default order when detection is unknown or matches a platform
 * not present in `platforms` (e.g. Windows before it ships, or iOS — which
 * is source-only and never appears in this list).
 */
export function orderByDetectedPlatform(
  platforms: readonly DownloadPlatform[],
  detected: DetectedPlatform,
): DownloadPlatform[] {
  const idx = platforms.findIndex((p) => p.id === detected)
  if (idx <= 0) return [...platforms]
  const reordered = [...platforms]
  const [match] = reordered.splice(idx, 1)
  reordered.unshift(match)
  return reordered
}
